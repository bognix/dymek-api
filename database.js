const AWS = require('aws-sdk');
const uuid = require('uuid/v4')
const ddbGeo = require('dynamodb-geo');

const MARKERS_TABLE = process.env.MARKERS_TABLE;
const DEV_DB_PORT = process.env.DEV_DB_PORT
const IS_OFFLINE = process.env.IS_OFFLINE;

let dynamoDb
if (IS_OFFLINE === 'true') {
  dynamoDb = new AWS.DynamoDB.DocumentClient({
    region: 'localhost',
    endpoint: `http://localhost:${DEV_DB_PORT}`
  })
} else {
  dynamoDb = new AWS.DynamoDB.DocumentClient();
}

const config = new ddbGeo.GeoDataManagerConfiguration(dynamoDb, MARKERS_TABLE);
config.longitudeFirst = true;
const markersGeoTableManager = new ddbGeo.GeoDataManager(config);

class Marker {}

function getMarker(id) {
  return new Promise((resolve, reject) => {
    dynamoDb.get({
      TableName: MARKERS_TABLE,
      Key: {
        id: id
      }
    }, (err, data) => {
      if (err) {
        console.log(err);
        throw new Error(`Could not get marker with id: ${id}`);
      }
      resolve(data)
    })
  })
}

function createMarker(latitude, longitude, type, userId) {
  const createdAt = new Date().toISOString()

  const latitudeNum = Number(latitude);
    const longitudeNum = Number(longitude);

    if (isNaN(latitudeNum) || isNaN(longitudeNum)) {
      throw new Error('Lat or Long has invalid form');
  }

  return markersGeoTableManager.putPoint({
    RangeKeyValue: { S: createdAt }, // Use this to ensure uniqueness of the hash/range pairs.
    GeoPoint: { // An object specifying latitutde and longitude as plain numbers. Used to build the geohash, the hashkey and geojson data
      latitude: latitudeNum,
      longitude: longitudeNum
    },
    PutItemInput: { // Passed through to the underlying DynamoDB.putItem request. TableName is filled in for you.
      Item: { // The primary key, geohash and geojson data is filled in for you
        userId: { S: userId }, // Specify attribute values using { type: value } objects, like the DynamoDB API.
        // type: { N: type },
        // craetedAt: { S: createdAt }
      }
    }
  })

  return new Promise((resolve, reject) => {
    if (!latitude || !longitude) {
      throw new Error('Lat or Long not set');
    }

    const latitudeNum = Number(latitude);
    const longitudeNum = Number(longitude);

    if (isNaN(latitudeNum) || isNaN(longitudeNum)) {
      throw new Error('Lat or Long has invalid form');
    }

    if (!userId) {
      throw new Error('You can not post markers as not identified user');
    }

    if (!type) {
      throw new Error('You can not create marker without a type');
    }

    const id = uuid()
    const createdAt = new Date().toISOString()

    const params = {
      TableName: MARKERS_TABLE,
      Item: {id, latitude: latitudeNum, longitude: longitudeNum, userId, createdAt, type},
    };

    dynamoDb.put(params, (error, item) => {
      if (error) {
        throw new Error('Could not create marker');
      }
      return resolve({ id, latitude, longitude, userId, createdAt, type: type });
    });
  })
}

function getMarkers(userId, markerType) {
  return new Promise ((resolve, reject) => {
    const params = {
      TableName: MARKERS_TABLE
    }
    let ExpressionAttributeNames = {}
    let ExpressionAttributeValues = {}

    // use userId-createdAt-index
    if (userId) {
      params.IndexName = "userId-createdAt-index"
      ExpressionAttributeValues[':userId'] = userId
      params.KeyConditionExpression = "userId=:userId"
    }

    if (markerType) {
      ExpressionAttributeValues[':markerType'] = markerType
      params.FilterExpression = "#t=:markerType"
      ExpressionAttributeNames['#t'] = 'type'
    }

    if (Object.keys(ExpressionAttributeValues).length) {
      params.ExpressionAttributeValues = ExpressionAttributeValues

      if (Object.keys(ExpressionAttributeNames).length) {
        params.ExpressionAttributeNames = ExpressionAttributeNames
      }
    }

    if (params.IndexName) {
      dynamoDb.query(params, (error, result) => {
        if (error) {
          console.log(error);
          throw new Error('Could not get markers')
        }

        if (result && result.Items) {
          return resolve(result.Items)
        }

        console.log(error);
        throw new Error('Could not get markers')
      });
    } else {
      dynamoDb.scan(params, (error, result) => {
        if (error) {
          console.log(error);
          throw new Error('Could not get markers')
        }

        if (result && result.Items) {
          return resolve(result.Items)
        }

        console.log(error);
        throw new Error('Could not get markers')
      });
    }
  })
}

module.exports = {
  Marker,
  getMarkers,
  getMarker,
  createMarker
}
