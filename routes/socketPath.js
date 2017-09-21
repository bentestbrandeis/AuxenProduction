//v.0.0.0
var models = require('../models/models');
var SpotifyWebApi = require('spotify-web-api-node');
var User = models.User;
var Room = models.Room;

module.exports = function(io) {
  io.on('connection', function(socket) {

    function getSpotifyApi() {

      var spotifyApi = new SpotifyWebApi({
        clientId: process.env.SPOTIFY_ID,
        clientSecret: process.env.SPOTIFY_SECRET,
        redirectUri: process.env.CALLBACK_URL
      });
      return spotifyApi;
    }

    function getDJData(DJAccessToken, room) {
      console.log("this should happen every 5 sec", room);
      var DJSpotifyApi = getSpotifyApi();
      DJSpotifyApi.setAccessToken(DJAccessToken);
      var startTime = Date.now();
      DJSpotifyApi.getMyCurrentPlaybackState().then(data => {
        var timeDiff = Date.now() - startTime;
        console.log("*****", data.body.progress_ms, data.body.item.uri);
        if (!io.sockets.adapter.rooms[room].songURI) { // it enters here for the first song of the room
          console.log("first time it should enter here");
          io.sockets.adapter.rooms[room].timeProgress = data.body.progress_ms; //setting time property to room
          io.sockets.adapter.rooms[room].songURI = data.body.item.uri; //setting song property to room
          io.sockets.adapter.rooms[room].songName = data.body.item.name; //setting song name property to room
          io.sockets.adapter.rooms[room].lastSongs = [data.body.item.name]; //setting lastSongs array property for the room
          console.log(data.body.item.name);
          var DJData = {
            songURI: data.body.item.uri,
            timeProgress: data.body.progress_ms + timeDiff,
            songName: data.body.item.name,
            lastSongs: io.sockets.adapter.rooms[room].lastSongs //update last songs Benjamin
          };
          io.to(room).emit("DJData", DJData);
        } else { // not first song of room
          console.log("second time it should enter here");
          if (io.sockets.adapter.rooms[room].songURI !== data.body.item.uri) { // song has changed
            console.log("song changed");
            io.sockets.adapter.rooms[room].timeProgress = data.body.progress_ms; //setting time property to room
            io.sockets.adapter.rooms[room].songURI = data.body.item.uri; //setting song property to room
            io.sockets.adapter.rooms[room].songName = data.body.item.name; //setting song name property to room
            if(io.sockets.adapter.rooms[room].lastSongs.length < 5){
              io.sockets.adapter.rooms[room].lastSongs.push(data.body.item.name);
            }else{
              var arr = io.sockets.adapter.rooms[room].lastSongs.slice(1);
              arr.push(data.body.item.name);
              io.sockets.adapter.rooms[room].lastSongs = arr;
            }
            var DJData = {
              songURI: data.body.item.uri,
              timeProgress: data.body.progress_ms + timeDiff,
              songName: data.body.item.name,
              lastSongs: io.sockets.adapter.rooms[room].lastSongs
            };
            io.to(room).emit("DJData", DJData);
          } else {
            console.log("song not changed");
            if (data.body.is_playing) {
              if (Math.abs(data.body.progress_ms - io.sockets.adapter.rooms[room].timeProgress) > 20000) {
                console.log("same song but change in time");
                var DJData = {
                  songURI: data.body.item.uri,
                  timeProgress: data.body.progress_ms + timeDiff,
                  songName: data.body.item.name
                };
                io.to(room).emit("DJData", DJData);
              }
              io.sockets.adapter.rooms[room].timeProgress = data.body.progress_ms;
            }
          }
        }
      }).catch(error => {
        console.log("error", error);
      })
    }

    function inActive(spotifyId){
      User.findOne({'spotifyId' : spotifyId})
      .then( user => {
        user.active = false;
        user.save();
      })
      .catch( err => {
        console.log(err);
      })
    }

    function clearRoom(roomName){
      console.log("clearing room and turning all members inactive");
      Room.findOne({"roomName":roomName})
      .then(room => {
        if(room){
          inActive(room.djSpotifyId);
          for(var i = 0;i<room.usersInRoom.length;i++){
            inActive(room.usersInRoom[i].spotifyId);
          };
          room.remove();
        }
      })
      .catch(err => {
        console.log(err);
      })
    }

    ///////////////////// PASS DJ ////////////////////////

    /* finds the right user from db. sets accestoken of user to dj token */
    socket.on('passDJ',function(passDjObject){
      console.log("passDjObject", passDjObject);
      User.findOne({spotifyId: passDjObject.nextDJSpotifyId})
      .then(user => {
        console.log("reached here for pass dj", user);
        io.sockets.adapter.rooms[socket.room].DJToken = user.accessToken;
        io.to(socket.room).emit('changedDJ', {
            spotifyId:passDjObject.nextDJSpotifyId,
            username: user.username
        });
      })
      .catch(error => {
        console.log("error", error);
      })
    })

    socket.on('takeBack', function(accessToken){
      io.sockets.adapter.rooms[socket.room].DJToken = accessToken;
      io.to(socket.room).emit('takeBack');
    })

    /* user was dj and left. get access token of host from db and set in room */
    socket.on('userDJLeaving', function(roomName){
      console.log("userDJLeaving backend");
      Room.findOne({roomName:roomName})
      .then(room => {
        console.log("room", room);
        User.findOne({spotifyId: room.djSpotifyId})
        .then(user => {
          io.sockets.adapter.rooms[roomName].DJToken = user.accessToken;
          io.to(roomName).emit('takeBack');
        })
      })
    })

    /* change token of room when user dj */
    socket.on('changeRoomTokenDJUser', function(userDJObject){
      User.findOne({spotifyId:userDJObject.spotifyId})
      .then(user => {
        io.sockets.adapter.rooms[userDJObject.roomName].DJToken = user.accessToken;
      })
      .catch(error => {
        console.log("error");
      })
    })

    /////////////////////// PASS DJ /////////////////////

    /////////////////// MULTIPLE TABS ///////////////////

    socket.on('active', function(spotifyId){
      User.findOne({'spotifyId' : spotifyId})
      .then( user => {
        user.active = true;
        user.save(function(err, user){
          console.log("changed user active status");
        });
      })
      .catch( err => {
        console.log(err);
      })
    })

    /////////////////// MULTIPLE TABS ///////////////////

    /* called every 30 minutes by user to refresh token */
    socket.on('toRefresh', function(refreshToken) {
      console.log("refreshing token");
      var spotifyApi = getSpotifyApi();
      spotifyApi.setRefreshToken(refreshToken);
      spotifyApi.refreshAccessToken()
      .then(data => {
        spotifyApi.setAccessToken(data.body['access_token']);
        socket.emit('setNewAccessToken', spotifyApi.getAccessToken());
        User.findOne({refreshToken: refreshToken})
        .then(user => {
          user.accessToken = spotifyApi.getAccessToken();
          user.save();
        })
        .catch(error => {
          console.log("error", error);
        })
      })
      .catch(error => {
        console.log("error", error);
      })
    })

    /* called on disconnect, does not do anything */
    socket.on('disconnect', function() {
      console.log('########user disconnected');
    });

    ///////////////// USER //////////////////////

    /* checks if user in particular room or not */
    socket.on('isInRoom', function(data){
      Room.findOne({"roomName": data.roomName})
      .then(room => {
        var user = room.usersInRoom.find(function(user){
          return user.spotifyId === data.spotifyId;
        })
        var flag = user ? true : false;
        socket.emit('isInRoom', flag);
      })
    })

    /* user joins room */
    socket.on('joinRoom', function(userObject) {
      console.log(userObject);
      if (socket.room) {
        socket.leave(socket.room);
      }
      socket.join(userObject.roomName);
      socket.room = userObject.roomName;
      console.log("socket room", socket.room);
      socket.to(userObject.roomName).emit('userJoined', userObject);
      var DJData = {
        songURI: io.sockets.adapter.rooms[userObject.roomName].songURI,
        timeProgress: io.sockets.adapter.rooms[userObject.roomName].timeProgress,
        songName: io.sockets.adapter.rooms[userObject.roomName].songName
      };
      socket.emit("DJData", DJData);
    })

    /* called by users while leaving room or when room closed altogether */
    socket.on('leaveRoom', function(userSpotifyId) {
      inActive(userSpotifyId);
      if (userSpotifyId) {
        socket.to(socket.room).emit('userLeaving', userSpotifyId);
      }
      socket.emit('redirect'); // emit this event to front end to redirect to home page
      socket.leave(socket.room);
    });

    /* user refreshed so adding to db */
    socket.on('userRefreshed', function(userObject) {
      socket.room = userObject.roomName;
      socket.join(userObject.roomName);
      console.log("user refreshed and added to database", userObject);
      Room.findById(userObject.roomId)
      .then(room => {
        console.log("room", room);
        var euser = room.usersInRoom.find(function(user) {
          return user.spotifyId === userObject.spotifyId;
        })
        if (euser)return;
        else {
          var user = {
            spotifyId: userObject.spotifyId,
            imageURL: userObject.imageURL,
            username: userObject.username
          }
          room.usersInRoom.push(user);
          room.save(function(err, room) {
            console.log("entered here");
            if (err)console.log(err);
            else {
              console.log("user successfully added");
              io.to(userObject.roomName).emit('userJoined', user);
              io.to(userObject.roomName).emit("DJData", {songName: io.sockets.adapter.rooms[userObject.roomName].songName});
            }
          })
        }
      })
      .catch(err => {
        console.log("error", err);
      })
    })

    /* user refreshed or closed tab */
    socket.on('specialLeave', function(userObject) {
      console.log("enetered specialLeave");
      inActive(userObject.spotifyId);
      if (userObject.spotifyId) {
        socket.to(socket.room).emit('userLeaving', userObject.spotifyId);
      }
      if(userObject.isDJ){
        socket.to(socket.room).emit('DJTakeBack');
      }
      socket.leave(socket.room);
      Room.findById(userObject.roomId)
      .then(room => {
        room.usersInRoom = room.usersInRoom.filter(function(user) {
          return user.spotifyId !== userObject.spotifyId;
        })
        room.save(function(err, room) {
          console.log("user successfully removed");
        });
      })
      .catch(error => {
        console.log("error", error);
      })
    })

    /* user makes song request to dj */
    socket.on('userTalk', function(data) {
      console.log('data', data)
      console.log("room is", socket.room);
      io.to(socket.room).emit('userTalk', data);
    });

    /* user sends flame to dj */
    socket.on('laflame', function() {
      if (socket.room){
        io.sockets.adapter.rooms[socket.room].laflame = io.sockets.adapter.rooms[socket.room].laflame + 1;
        io.to(socket.room).emit('laflame', io.sockets.adapter.rooms[socket.room].laflame);
      }
    });

    ////////////////// USER ENDS //////////////////

    /////////////////// DJ ///////////////////////

    /* create room in socket with dj information */
    socket.on('createRoom', function(djObject) {
      console.log("starting to create room");
      var roomName = djObject.roomName;
      if (socket.room)
        socket.leave(socket.room); //if already in room leave
      socket.room = roomName; // set property
      socket.join(roomName); // join room
      io.sockets.adapter.rooms[roomName].DJToken = djObject.accessToken;
      io.sockets.adapter.rooms[roomName].laflame = 0;
      var clearID = setInterval(() => {
        if (io.sockets.adapter.rooms[roomName]) {
          return getDJData(io.sockets.adapter.rooms[roomName].DJToken, roomName);
        } else {
          console.log("this room no longer exists");
          // Room.remove({'roomName': roomName})
          // .then(room => {
          //   console.log("*********** room successfully removed ****************************");
          // })
          // .catch((error) => {
          //   console.log("error", error);
          // });
          clearRoom(roomName);
          clearInterval(clearID);
        }
      }, 5000);
    })

    /* called by dj. closes room, dj leaves room, and emits events for users to leave room */
    socket.on('closingRoom', function(roomData) {
      inActive(roomData.spotifyId);
      console.log("backend closingRoom");
      socket.to(socket.room).emit('roomClosed');
      socket.leave(socket.room);
    })

    /* dj closed tab or refreshed */
    socket.on('specialClose', function(roomObject) {
      console.log("backend closingRoom");
      inActive(roomObject.spotifyId);
      socket.to(socket.room).emit('roomClosed');
      socket.leave(socket.room);
      console.log("reaching autoclose at backend");
      Room.remove({'_id': roomObject.roomId}).then(() => {
        console.log("room successfully removed");
      }).catch((error) => {
        console.log("error", error);
      })
    })

    /* after access token is changed for dj, i set that token to room here */
    socket.on('changeRoomToken', function(data) {
      io.sockets.adapter.rooms[data.roomName].DJToken = data.newToken;
    });

    /* dj sends messages */
    socket.on('djTalk', function(data) {
      io.to(socket.room).emit('djTalk', data);
    });

    /* dj sends thanks */
    socket.on('sendgrace', function() {
      console.log('shit');
      socket.to(socket.room).emit('sendgrace');
    })

    /* mantains flame count */
    socket.on('getflames', function() {
      if(socket.room)socket.emit('getflames', io.sockets.adapter.rooms[socket.room].laflame)

    })

    socket.on('startPinging', function(spotifyId){

      var flag = true;

      var id = setInterval(function(){
        flag  = false;
        socket.emit('ping');
      }, 30*60000);

      socket.on('pong', function(){
        flag = true;
      })

      var id2 = setInterval(function(){
        if(!flag){
          console.log("THIS IS AMAZING");
        }
      }, 35*60000);

    })

    //////////////////// DJ ENDS ///////////////////
  })

}
