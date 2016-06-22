'use strict';

const _ = require('lodash');
const Boom = require('boom');

const JSON_API_KEYS = ['id', 'type', 'relationships', 'meta', 'links'];

// options.bus - Object *required*
module.exports = function (options) {
	options = options || {};
	const BASE_PREFIX = options.baseUrlPrefix;

	const bus = options.bus;

	if (!bus || !_.isObject(bus)) {
		throw new Error('options.bus is required.');
	}

	function format(data, baseUrl) {
		const resource = {};

		if (data.id && data.type) {
			resource.id = data.id;
			resource.type = data.type;
			resource.attributes = _.omit(data, JSON_API_KEYS);
			resource.relationships = data.relationships || {};
			resource.links = {
				self: `${baseUrl}/${resource.type}s/${resource.id}`
			};
			resource.meta = data.meta || {};
		}

		return resource;
	}

	function composeIncluded(data, baseUrl) {
		const relationships = data.relationships || {};
		const included = data.included || [];

		// Remove relationship references that were not found.
		Object.keys(relationships).forEach(key => {
			const rel = relationships[key].data || [];
			rel.slice().forEach((item, i) => {
				const foundIndex = _.findIndex(included, {type: item.type, id: item.id});
				if (foundIndex < 0) {
					bus.broadcast({level: 'warn', event: 'json-api-missing-relationship'}, {
						message: `id:${data.id}, key:${key}, fk:${item.id}`
					});
					rel.splice(i, 1);
				}
			});
		});

		if (included.length) {
			return included.map(entity => {
				return format(entity, baseUrl);
			});
		}

		return [];
	}

	return function responseJsonApi(req, res, next) {
		if (!res.body) {
			return next(Boom.notFound());
		}

		let baseUrl = `${req.protocol}://${req.hostname}`;
		const port = req.socket.address().port;
		if (port >= 1024) {
			baseUrl = `${baseUrl}:${port}`;
		}
		if (BASE_PREFIX) {
			baseUrl = `${baseUrl}${BASE_PREFIX}`;
		}

		const data = _.cloneDeep(res.body);
		res.body = {};

		if (_.isArray(data)) {
			res.body.data = data.map(object => {
				delete object.included;
				return format(object, baseUrl);
			});

			res.body.links = {
				self: `${baseUrl}${req.originalUrl}`
			};
		} else {
			if (_.isString(req.query.include)) {
				res.body.included = composeIncluded(data, baseUrl);
			}
			delete data.included;
			res.body.data = format(data, baseUrl);
			res.body.links = data.links;
		}

		res.body.meta = {};

		if (req.identity) {
			if (req.identity.channel) {
				res.body.meta.channel = req.identity.channel.id;
			}
			if (req.identity.platform) {
				res.body.meta.channel = req.identity.platform.id;
			}
		}

		res.send(res.body);
	};
};