const AWS = require('aws-sdk');
const uuid = require('uuid/v4')
const ddbGeo = require('dynamodb-geo');
const {dynamoDb, dynamoDbClient} =  require('./index');
const User = require('./users');
const notifier = require('../server/notifier');

const MARKERS_TABLE = process.env.MARKERS_TABLE;

const MARKERS_SUPPORTED_TYPES = {
  DOG_POOP: 'DOG_POOP',
  ILLEGAL_PARKING: 'ILLEGAL_PARKING',
  CHIMNEY_SMOKE: 'CHIMNEY_SMOKE'
}

const MARKERS_SUPPORTED_STATUSES = {
  RESOLVED: 'RESOLVED',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  REJECTED: 'REJECTED',
  NEW: 'NEW'
}

const config = new ddbGeo.GeoDataManagerConfiguration(dynamoDb, MARKERS_TABLE);
config.longitudeFirst = true;
config.hashKeyLength = 5;
config.rangeKeyAttributeName = 'createdAt'
const markersGeoTableManager = new ddbGeo.GeoDataManager(config);

class Marker {}

function getMarker(id) {
  return dynamoDbClient.query({
    TableName: MARKERS_TABLE,
    IndexName: 'id-index',
    ExpressionAttributeValues: {
      ':id': id
    },
    KeyConditionExpression: 'id=:id',
    Limit: 1
  }).promise()
    .then(({Items}) => {
      const marker = new Marker()
      return User.getUser(Items[0].userId)
        .then(user => {
          return Object.assign(marker, {user: Object.assign({}, user)}, Items[0])
        })
  }).catch((err) => {
    throw new Error(err)
  })
}

function createMarker(latitude, longitude, type, userId) {
  const createdAt = new Date().toISOString()
  const id = uuid();

  if (!MARKERS_SUPPORTED_TYPES[type]) {
    throw new Error('Not supported type')
  }

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

  return markersGeoTableManager.putPoint({
    RangeKeyValue: { S: createdAt },
    GeoPoint: {
      latitude: latitude,
      longitude: longitude
    },
    PutItemInput: {
      Item: {
        type: { S: MARKERS_SUPPORTED_TYPES[type] },
        userId: { S: userId },
        id: { S: id },
        status: { S: MARKERS_SUPPORTED_STATUSES.NEW }
      }
    }
  }).promise()
  .then(() => getMarker(id))
}

function getMarkers({userId, markerTypes = [], location}, internal = false) {
  return new Promise ((resolve, reject) => {
    if (!location && !userId && !markerTypes.length && !internal) {
      throw new Error('You need to provide at least one filter')
      return reject();
    }
    const params = {
      TableName: MARKERS_TABLE
    }
    let ExpressionAttributeNames = {}
    let ExpressionAttributeValues = {}

    if (markerTypes.length && markerTypes.find(type => !MARKERS_SUPPORTED_TYPES[type])) {
      throw new Error('One of passed types is not supported')
    }

    if (location) {
      return markersGeoTableManager.queryRadius({
        RadiusInMeter: location.radius,
        CenterPoint: {
          latitude: location.latitude,
          longitude: location.longitude
        }
      })
      .then((items) => {
        let filteredItems = items;
        if (userId) {
          filteredItems = filteredItems.filter(item => {
            return item.userId.S === userId
          })
        }

        if (markerTypes.length) {
          filteredItems = filteredItems.filter(item => {
            const typeName = MARKERS_SUPPORTED_TYPES[item.type.S];
            return markerTypes.includes(item.type.S)
          })
        }
        return resolve(filteredItems.map(item => AWS.DynamoDB.Converter.unmarshall(item)))
      });
    }

    // use userId-createdAt-index
    if (userId) {
      params.IndexName = "userId-createdAt-index"
      ExpressionAttributeValues[':userId'] = userId
      params.KeyConditionExpression = "userId=:userId"

      if (markerTypes.length) {
        const keyVals = {};
        markerTypes.forEach((type, index) => keyVals[`:typeValue${index}`] = type)
        ExpressionAttributeNames['#t'] = 'type'
        params.FilterExpression = `#t in (${Object.keys(keyVals).join(', ')})`
        ExpressionAttributeValues  = Object.assign(ExpressionAttributeValues, keyVals);
      }
    }

    if (Object.keys(ExpressionAttributeValues).length) {
      params.ExpressionAttributeValues = ExpressionAttributeValues

      if (Object.keys(ExpressionAttributeNames).length) {
        params.ExpressionAttributeNames = ExpressionAttributeNames
      }
    }

    if (params.IndexName) {
      return dynamoDbClient.query(params, (error, result) => {
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

    if (internal) {
      return dynamoDbClient.scan(params, (error, result) => {
        return resolve(result.Items)
      })
    }

    throw new Error('oops, query not supported');
  })
}

function updateMarker(id, status) {
  if (!id) {
    throw new Error('Pass ID in order to update marker')
  }

  if (!MARKERS_SUPPORTED_STATUSES[status]) {
    throw new Error('Status not supported')
  }

  return getMarker(id)
    .then(marker => {
      const oldStatus = marker.status;

      if (oldStatus === status) {
        return Promise.resolve(marker);
      }

      return dynamoDbClient.update(
        {
          TableName: MARKERS_TABLE,
          Key: {
            'hashKey': marker.hashKey,
            'createdAt': marker.createdAt
          },
          ExpressionAttributeValues: {
            ':status': status,
          },
          ExpressionAttributeNames: {
            '#s': 'status'
          },
          UpdateExpression: 'set #s = :status',
        }).promise()
        .then(() => {
          return new Promise((resolve, reject) => {
            User.getUser(marker.userId)
              .then((user) =>  {
                notifier.notify({
                  token: user.registrationToken,
                  message: {
                    title: 'Zmiana statusu zgłoszenia',
                    body: `Twoje zgłoszenie zmieniło status z ${oldStatus} na ${status}`,
                    meta: Object.assign({}, marker, {oldStatus})
                  }
                })
                return resolve(Object.assign(marker, {status}))
            })
          })
        })
    })
}

module.exports = {
  Marker,
  getMarkers,
  getMarker,
  createMarker,
  updateMarker,
  MARKERS_SUPPORTED_TYPES
}
