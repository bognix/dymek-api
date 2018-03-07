const {
    GraphQLBoolean,
    GraphQLID,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLSchema,
    GraphQLString,
    GraphQLFloat,
    GraphQLEnumType
  } = require('graphql');

  const {
    connectionArgs,
    connectionDefinitions,
    connectionFromPromisedArray,
    cursorForObjectInConnection,
    offsetToCursor,
    fromGlobalId,
    globalIdField,
    mutationWithClientMutationId,
    nodeDefinitions,
    toGlobalId,
  } = require('graphql-relay');

  const {
    Marker,
    getMarkers,
    getMarker,
    createMarker
  } = require('./database');

  const {nodeInterface, nodeField} = nodeDefinitions(
    (globalId) => {
      const {type, id} = fromGlobalId(globalId);
      if (type === 'Marker') {
        return getMarker(id);
      }
      return null;
    },
    (obj) => {
      if (obj instanceof Marker) {
        return GraphQLMarker;
      }
      return null;
    }
  );

  const GraphQLMarkerType = new GraphQLEnumType({
    name: 'MarkerType',
    values: {
      CHIMNEY_SMOKE: { value: 0 },
      DOG_POOP: { value: 1 },
      ILLEGAL_PARKING: { value: 2 }
    }
  });

  const GraphQLGeoJson = new GraphQLObjectType({
    name: 'GeoJson',
    fields: {
      coordinates: {
        type: new GraphQLList(GraphQLFloat),
        resolve: (obj) => obj.coordinates
      }
    }
  });

  const GraphQLMarker = new GraphQLObjectType({
    name: 'Marker',
    fields: {
      id: {
        type: new GraphQLNonNull(GraphQLID),
        resolve: (obj) => obj.hashKey
      },
      createdAt: {
        type: GraphQLString,
        resolve: (obj) => obj.rangeKey,
      },
      userId: {
        type: GraphQLID
      },
      type: {
        type: GraphQLMarkerType
      },
      geoJson: {
        type: GraphQLGeoJson,
        resolve: obj => JSON.parse(obj.geoJson)
      }
    },
    interfaces: [nodeInterface],
  });

  const {
    connectionType: MarkersConnection,
    edgeType: GraphQLMarkerEdge,
  } = connectionDefinitions({
    name: 'Marker',
    nodeType: GraphQLMarker,
  });

  const argsWithUserId = Object.assign({
    userId: {
      type: GraphQLID
    },
    type: {
      type: GraphQLMarkerType
    }
  }, connectionArgs)

  const Root = new GraphQLObjectType({
    name: 'Root',
    fields: {
      markers: {
        type: MarkersConnection,
        args: argsWithUserId,
        resolve: (obj, args) => {
          return connectionFromPromisedArray(getMarkers(args.userId, args.type), args)
        }
      },
      node: nodeField,
    },
  });

  const GraphQLCreateMarkerMutation = mutationWithClientMutationId({
    name: 'CreateMarker',
    inputFields: {
      latitude: { type: new GraphQLNonNull(GraphQLFloat) },
      longitude: { type: new GraphQLNonNull(GraphQLFloat) },
      type: {type: GraphQLMarkerType}
    },
    outputFields: {
      markerEdge: {
        type: GraphQLMarkerEdge,
        resolve: (marker) => {
          return getMarkers()
            .then(markers => {
              return Promise.resolve({
                cursor: offsetToCursor(markers.findIndex((m => m.id === marker.id))),
                node: marker
              })
            }).catch(err => {
              console.log(err)
              throw new Error(err);
            });
        },
      }
    },
    mutateAndGetPayload: ({longitude, latitude, type}, {req}) => {
      const userId = req.headers['x-dymek-user-id'] || (req.body.variables.dev && '123-456')
      const marker = createMarker(latitude, longitude, type, userId)
      console.log(marker)
      return marker
    },
  });

  const Mutation = new GraphQLObjectType({
    name: 'Mutation',
    fields: {
      createMarker: GraphQLCreateMarkerMutation
    },
  });

  module.exports.schema = new GraphQLSchema({
    query: Root,
    mutation: Mutation,
  });
