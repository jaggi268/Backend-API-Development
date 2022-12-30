const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;
let usernameOfUser = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(-1);
  }
};

initializeDbAndServer();
const convertDBTweetObjectToResponseObject = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

function authenticateToken(request, response, next) {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        next();
      }
    });
  }
}

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const lastIdQuery = `SELECT MAX(user_id) as lastId FROM user`;
      const lastIDObject = await database.get(lastIdQuery);
      const { lastId } = lastIDObject;
      const hashedPassword = await bcrypt.hash(password, 10);
      const insertUserQuery = `INSERT INTO user(user_id,name,username,password,gender) VALUES(${
        lastId + 1
      }, '${name}','${username}','${hashedPassword}', '${gender}')`;
      await database.run(insertUserQuery);
      console.log(username);

      response.status(200);
      response.send("User created successfully");
    }
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await database.get(selectUserQuery);
  if (databaseUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      databaseUser.password
    );
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      usernameOfUser = username;
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed", authenticateToken, async (request, response) => {
  const getLatestTweets = `select 
  (select user.username FROM user WHERE user.user_id = following_user_id) as username,
  tweet,date_time 
  FROM user INNER JOIN 
  follower ON user.user_id = follower.follower_user_id 
  INNER JOIN TWEET ON following_user_id = tweet.user_id 
  WHERE USER.username = '${usernameOfUser}'  
  ORDER BY date_time 
  DESC LIMIT 4; `;
  const latestTweetsArray = await database.all(getLatestTweets);
  response.send(
    latestTweetsArray.map((eachItem) =>
      convertDBTweetObjectToResponseObject(eachItem)
    )
  );
});

app.get("/user/following/", authenticateToken, async (request, response) => {
  const getFollowing = `
        select (select user.name FROM user WHERE user.user_id = following_user_id) as name FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id WHERE USER.username = '${usernameOfUser}'
    `;
  const followingArray = await database.all(getFollowing);
  response.send(followingArray);
});

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const getFollowersQuery = `
  select (select user.name FROM user WHERE user.user_id = follower_user_id) as name FROM user INNER JOIN follower ON user.user_id = follower.following_user_id WHERE USER.username = '${usernameOfUser}'  ;
    `;
  const followerArray = await database.all(getFollowersQuery);
  response.send(followerArray);
});

app.get("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  let checkForFollowingQuery = `
    SELECT tweet FROM tweet WHERE tweet.user_id IN 
    (
        select (select user.USER_ID FROM user WHERE user.user_id = following_user_id) as user_id FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id WHERE USER.username = '${usernameOfUser}'
    )
  `;
  const followingTweets = await database.all(checkForFollowingQuery);
  //   console.log(followingTweets);
  let flag = false;
  const checkQuery = `
  SELECT tweet FROM tweet WHERE tweet_id = ${tweetId};
  `;
  const checkTweet = await database.get(checkQuery);
  //   console.log(checkTweet);
  for (let eachItem of followingTweets) {
    if (eachItem.tweet === checkTweet.tweet) {
      flag = true;
    }
  }
  if (flag === true) {
    const getTweetQuery = `
      
       ;SELECT (SELECT tweet FROM tweet WHERE tweet_id = ${tweetId}) as tweet,(SELECT COUNT(like_id) FROM like WHERE tweet_id = ${tweetId}) as likes,(SELECT COUNT(reply_id) FROM reply WHERE reply.tweet_id = ${tweetId}) as replies,date_time as dateTime FROM tweet
      `;
    const TweetStats = await database.get(getTweetQuery);
    response.send(TweetStats);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    let checkForFollowingQuery = `
    SELECT tweet FROM tweet WHERE tweet.user_id IN 
    (
        select (select user.USER_ID FROM user WHERE user.user_id = following_user_id) as user_id FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id WHERE USER.username = '${usernameOfUser}'
    )
  `;
    const followingTweets = await database.all(checkForFollowingQuery);
    //   console.log(followingTweets);
    let flag = false;
    const checkQuery = `
  SELECT tweet FROM tweet WHERE tweet_id = ${tweetId};
  `;
    const checkTweet = await database.get(checkQuery);
    //   console.log(checkTweet);
    for (let eachItem of followingTweets) {
      if (eachItem.tweet === checkTweet.tweet) {
        flag = true;
      }
    }
    if (flag === true) {
      const getLikedUsersQuery = `
      SELECT user.username FROM user INNER JOIN like ON user.user_id = like.user_id AND tweet_id = ${tweetId}
      `;
      const getLikedUsersArray = await database.all(getLikedUsersQuery);
      //   response.send(getLikedUsersArray);
      let array = [];
      for (let eachItem of getLikedUsersArray) {
        array.push(eachItem.username);
      }
      response.send({
        likes: array,
      });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    let checkForFollowingQuery = `
    SELECT tweet FROM tweet WHERE tweet.user_id IN 
    (
        select (select user.USER_ID FROM user WHERE user.user_id = following_user_id) as user_id FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id WHERE USER.username = '${usernameOfUser}'
    )
  `;
    const followingTweets = await database.all(checkForFollowingQuery);
    //   console.log(followingTweets);
    let flag = false;
    const checkQuery = `
  SELECT tweet FROM tweet WHERE tweet_id = ${tweetId};
  `;
    const checkTweet = await database.get(checkQuery);
    //   console.log(checkTweet);
    for (let eachItem of followingTweets) {
      if (eachItem.tweet === checkTweet.tweet) {
        flag = true;
      }
    }
    if (flag === true) {
      const getRepliedUsersQuery = `
        SELECT user.name,reply FROM user INNER JOIN reply ON user.user_id = reply.user_id WHERE tweet_id = ${tweetId}
        `;
      const getRepliedUsersArray = await database.all(getRepliedUsersQuery);
      response.send({
        replies: getRepliedUsersArray,
      });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const getTweetsOfUserIdQuery = `
    SELECT tweet_id
    FROM tweet INNER JOIN user ON tweet.user_id = user.user_id WHERE user.user_id = (SELECT user_id FROM user WHERE username = '${usernameOfUser}' )
    `;
  const tweetsOfUserIds = await database.all(getTweetsOfUserIdQuery);
  let tweetsOfUserIdsArray = [];
  for (let eachItem of tweetsOfUserIds) {
    tweetsOfUserIdsArray.push(eachItem.tweet_id);
  }
  let tweetsOfUser = [];
  for (let Id of tweetsOfUserIdsArray) {
    const getTweetsQuery = `
        SELECT (SELECT tweet FROM tweet WHERE tweet_id = ${Id}) as tweet,(SELECT COUNT(like_id) FROM like WHERE tweet_id = ${Id}) as likes,(SELECT COUNT(reply_id) FROM reply WHERE reply.tweet_id = ${Id}) as replies,date_time as dateTime FROM tweet
      `;
    let tweet = await database.get(getTweetsQuery);
    tweetsOfUser.push(tweet);
  }
  response.send(tweetsOfUser);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const userIdQuery = `SELECT user_id as userId FROM user WHERE username = '${usernameOfUser}'`;
  const { userId } = await database.get(userIdQuery);
  const lastTweetIdQuery = `SELECT MAX(tweet_id) as lastId FROM tweet `;
  const { lastId } = await database.get(lastTweetIdQuery);
  const dateTimeQuery = `SELECT datetime('now') as dateTime`;
  const { dateTime } = await database.get(dateTimeQuery);
  const insertTweetQuery = `
  INSERT INTO 
  tweet(tweet_id,tweet,user_id,date_time)
   VALUES 
   (${lastId + 1},'${tweet}',${userId},'${dateTime}')
   `;
  await database.run(insertTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    let checkForFollowingQuery = `
    SELECT tweet FROM tweet WHERE tweet.user_id IN 
    (
        select (select user.USER_ID FROM user WHERE user.user_id = following_user_id) as user_id FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id WHERE USER.username = '${usernameOfUser}'
    )
  `;
    const followingTweets = await database.all(checkForFollowingQuery);
    //   console.log(followingTweets);
    let flag = false;
    console.log(flag);

    const checkQuery = `
  SELECT tweet FROM tweet WHERE tweet_id = ${tweetId};
  `;
    const checkTweet = await database.get(checkQuery);
    //   console.log(checkTweet);
    for (let eachItem of followingTweets) {
      if (eachItem.tweet === checkTweet.tweet) {
        flag = true;
      }
    }
    console.log(flag);
    if (flag === true) {
      const deleteTweetQuery = `
        DELETE FROM tweet WHERE tweet_id = ${tweetId};
        `;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
