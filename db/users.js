const {dynamoDb, dynamoDbClient} =  require('./index');

const USERS_TABLE = process.env.USERS_TABLE;

class User {}

function getUser(id) {
  return dynamoDbClient.query({
    TableName: USERS_TABLE,
    ExpressionAttributeValues: {
      ':id': id
    },
    KeyConditionExpression: 'userId=:id',
    Limit: 1
  }).promise().then(({Items}) => {
    const user = new User()
    console.log('...getting user with ID....', id);
    return Object.assign(user, Items[0])
  })
}

function updateOrCreateUser(id, registrationToken = null) {
  const updatedAt = new Date().toISOString()
  console.log(id, registrationToken, '......updateOrCreateUser....');

  if (!id) {
    throw new Error('Can not create user without ID')
  }

  return dynamoDbClient.update(
    {
      TableName: USERS_TABLE,
      Key: {
        userId: id
      },
      UpdateExpression: 'set registrationToken = :token, updatedAt = :date',
      ExpressionAttributeValues: {
        ':token': registrationToken,
        ':date': updatedAt
      }
    }
  ).promise().then(() => getUser(id))
}

module.exports = {
  User,
  getUser,
  updateOrCreateUser,
}
