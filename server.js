var express     = require('express');
var app         = express();
var couchbase   = require('couchbase');
var server      = require('http').Server(app);
var io          = require('socket.io')(server);
var port        = process.env.PORT || 80;


exports.connectCouch = function (cb, bucketName, port) {
    var bucket = new couchbase.Connection({
        'bucket': bucketName || 'default',
        'host': 'localhost:' + port || '8091' // couchbase default port is 8091
    }, function(err) {
        if (err) { // Failed to make a connection to the Couchbase cluster.
            console.log('error');
            throw err;
        } else { // Success! 
            console.log('Connected to couchbase');
            cb(bucket);
        }
    });
    return bucket;
}

exports.initialize = function (bucket) { // start 

    // usernames which are currently connected to the chat
    var usernames = {};
    var numUsers = 0;

    server.listen(port, function() {
        console.log('Server listening at port %d', port);

        // Routing
        app.use('/js', express.static(__dirname + '/public/js'));
        app.use('/css', express.static(__dirname + '/public/css'));
        app.use(express.static(__dirname + '/public'));


        // Chatroom
        io.on('connection', function(socket) {
            var addedUser = false;

            // when the client emits 'new message', this listens and executes
            socket.on('new message', function(data) {
                // we tell the client to execute 'new message'
                var messageObj = {
                    type: 'message',
                    username: socket.username,
                    message: data,
                    timestamp: Date.now()
                }

                bucket.incr("msg_count", {
                    initial: 0,
                    offset: 1
                }, function(err, result) {
                    // result is the incremented value [0-9]*
                    var messageKey = "msg:" + result.value;
                    messageObj.id = result;

                    // Store the messageObj using msg:nth as the key
                    bucket.set(messageKey, JSON.stringify(messageObj), function(err) {}); 
                    console.log('set: ' + messageKey + ' content: ' + JSON.stringify(messageObj));

                    // Send the messageObj to the client
                    socket.broadcast.emit('new message', messageObj);
                });


            });

            // when the client emits 'add user', this listens and executes
            socket.on('add user', function(username) {
                // we store the username in the socket session for this client
                socket.username = username;
                // add the client's username to the global list
                usernames[username] = username;
                ++numUsers;
                addedUser = true;

                //
                var oldMessageCount, msgKeys = [];


                bucket.get('msg_count', function(err, result) {
                    oldMessageCount = result.value;
                    oldMessageCount = (oldMessageCount > 100 ? 100 : oldMessageCount); // We're only doing history of 100 for now..
                    console.log('There are ' + result.value + ' messages | Sending ' + oldMessageCount + ' to client'); // well actually the count is 1 short but since it's just a log that's fine 

                    for (var i = 0; i < oldMessageCount + 1; i++) { // make an array of keys
                        msgKeys.push('msg:' + i);
                    }
                    console.log(msgKeys);

                    bucket.getMulti(msgKeys, null, function(err, result) { // use the array of keys to fetch the old messages
                        socket.emit('login', {
                            numUsers: numUsers,
                            history: result
                        });
                    });
                });

                // echo globally (all clients) that a person has connected
                socket.broadcast.emit('user joined', {
                    username: socket.username,
                    numUsers: numUsers
                });


            });

            // when the client emits 'typing', we broadcast it to others
            socket.on('typing', function() {
                socket.broadcast.emit('typing', {
                    username: socket.username
                });
            });

            // when the client emits 'stop typing', we broadcast it to others
            socket.on('stop typing', function() {
                socket.broadcast.emit('stop typing', {
                    username: socket.username
                });
            });

            // when the user disconnects.. perform this
            socket.on('disconnect', function() {
                // remove the username from global usernames list
                if (addedUser) {
                    delete usernames[socket.username];
                    --numUsers;

                    // echo globally that this client has left
                    socket.broadcast.emit('user left', {
                        username: socket.username,
                        numUsers: numUsers
                    });
                }
            });
        });
    });
}
