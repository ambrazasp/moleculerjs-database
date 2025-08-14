/*
 * @moleculer/database
 * Copyright (c) 2022 MoleculerJS (https://github.com/moleculerjs/database)
 * MIT Licensed
 */

"use strict";

const _ = require("lodash");
let Knex;

const BaseAdapter = require("./base");

class KnexAdapter extends BaseAdapter {
	/**
	 * Constructor of adapter.
	 *
	 * @param  {Object?} opts
	 * @param  {Object?} opts.knex More Info: http://knexjs.org/#Installation-client
	 */
	constructor(opts) {
		if (_.isString(opts))
			opts = {
				tableName: null,
				schema: null,
				knex: {
					client: "pg",
					connection: opts,
					log: {
						log: message => this.logger.info(message),
						warn: message => this.logger.warn(message),
						error: message => this.logger.error(message),
						deprecate: message => this.logger.warn(message),
						debug: message => this.logger.debug(message)
					}
				}
			};

		super(opts);

		this.client = null;
		this.idFieldName = "id";
	}

	/**
	 * The adapter has nested-field support.
	 */
	get hasNestedFieldSupport() {
		return false;
	}

	/**
	 * Initialize the adapter.
	 *
	 * @param {Service} service
	 */
	init(service) {
		super.init(service);

		if (this.service.$primaryField) this.idFieldName = this.service.$primaryField.columnName;
		if (!this.opts.tableName) this.opts.tableName = service.name;

		try {
			Knex = require("knex");
		} catch (err) {
			/* istanbul ignore next */
			this.broker.fatal(
				"The 'knex' package is missing! Please install it with 'npm install knex --save' command.",
				err,
				true
			);
		}

		this.checkClientLibVersion("knex", "^0.95.4 || ^1.0.1 || ^2.0.0 || ^3.0.0");
	}

	/**
	 * Connect adapter to database
	 */
	async connect() {
		this.logger.debug(`Knex connecting...`);
		// Should clone because Kney hides the password field
		this.client = new Knex(_.cloneDeep(this.opts.knex));
	}

	/**
	 * Disconnect adapter from database
	 */
	async disconnect() {
		if (this.client) await this.client.destroy();
	}

	/**
	 * Get the table instance
	 *
	 * @param {any?} trx
	 * @returns
	 */
	getTable(trx) {
		const c = trx || this.client;
		if (this.opts.schema) {
			return c.withSchema(this.opts.schema).table(this.opts.tableName);
		} else {
			return c.table(this.opts.tableName);
		}
	}

	/**
	 * Get Knex client with schema.
	 *
	 * @returns
	 */
	getSchemaClient() {
		return this.opts.schema
			? this.client.schema.withSchema(this.opts.schema)
			: this.client.schema;
	}

	/**
	 * Find all entities by filters.
	 *
	 * @param {Object} params
	 * @returns {Promise<Array>}
	 */
	find(params) {
		return this.createQuery(params);
	}

	/**
	 * Find an entity by query & sort
	 *
	 * @param {Object} params
	 * @returns {Promise<Object>}
	 */
	async findOne(params) {
		return this.createQuery(params).first();
	}

	/**
	 * Find an entities by ID.
	 *
	 * @param {String} id
	 * @returns {Promise<Object>} Return with the found document.
	 *
	 */
	findById(id) {
		return this.findOne({ query: { [this.idFieldName]: id } });
	}

	/**
	 * Find any entities by IDs.
	 *
	 * @param {Array<String>} idList
	 * @returns {Promise<Array>} Return with the found documents in an Array.
	 *
	 */
	findByIds(idList) {
		return this.getTable().select().whereIn(this.idFieldName, idList);
	}

	/**
	 * Find all entities by filters and returns a Stream.
	 *
	 * @param {Object} params
	 * @returns {Promise<Stream>}
	 */
	findStream(params) {
		return this.createQuery(params).stream();
	}

	/**
	 * Get count of filtered entites.
	 * @param {Object} [params]
	 * @returns {Promise<Number>} Return with the count of documents.
	 *
	 */
	async count(params) {
		const res = await this.createQuery(params, { counting: true });
		const count = res && res.length > 0 ? res[0].count : 0;
		// Pg returns `string` value
		return typeof count == "string" ? Number(count) : count;
	}

	/**
	 * Insert an entity.
	 *
	 * @param {Object} entity
	 * @returns {Promise<Object>} Return with the inserted document.
	 *
	 */
	async insert(entity) {
		const res = await this.getTable().insert(entity, [this.idFieldName]);

		if (res && res.length > 0) {
			// Sqlite returns only a single value which is the ID
			// Postgres returns an object with only the ID field.
			let id = entity[this.idFieldName] || res[0];
			if (typeof id == "object") {
				id = id[this.idFieldName];
			}
			return await this.findById(id);
		}
		return res;
	}

	/**
	 * Insert many entities
	 *
	 * @param {Array<Object>} entities
	 * @param {Object?} opts
	 * @param {Boolean?} opts.returnEntities
	 * @returns {Promise<Array<Object|any>>} Return with the inserted IDs or entities.
	 *
	 */
	async insertMany(entities, opts = {}) {
		let res = await this.client.transaction(trx =>
			Promise.all(
				entities.map(entity => this.getTable(trx).insert(entity, [this.idFieldName]))
			)
		);

		res = _.flatten(res).map(r => (typeof r == "object" ? r[this.idFieldName] : r));

		if (opts.returnEntities) {
			res = await this.findByIds(res);
		}

		return res;
	}

	/**
	 * Update an entity by ID
	 *
	 * @param {String} id
	 * @param {Object} changes
	 * @param {Object} opts
	 * @returns {Promise<Object>} Return with the updated document.
	 *
	 */
	async updateById(id, changes, opts) {
		const raw = opts && opts.raw ? true : false;
		let p = this.getTable().where(this.idFieldName, id);
		if (raw) {
			// Handle $set, $inc
			if (changes.$set) {
				p = p.update(changes.$set);
			}
			if (changes.$inc) {
				p = p.increment(changes.$inc);
			}
		} else {
			p = p.update(changes);
		}
		await p;

		return this.findById(id);
	}

	/**
	 * Update many entities
	 *
	 * @param {Object} query
	 * @param {Object} changes
	 * @param {Object} opts
	 * @returns {Promise<Number>} Return with the count of modified documents.
	 *
	 */
	async updateMany(query, changes, opts) {
		const raw = opts && opts.raw ? true : false;
		let p = this.getTable().where(query);
		if (raw) {
			// Handle $set, $inc
			if (changes.$set) {
				p = p.update(changes.$set);
			}
			if (changes.$inc) {
				p = p.increment(changes.$inc);
			}
		} else {
			p = p.update(changes);
		}
		return p;
	}

	/**
	 * Replace an entity by ID
	 *
	 * @param {String} id
	 * @param {Object} entity
	 * @returns {Promise<Object>} Return with the updated document.
	 *
	 */
	async replaceById(id, entity) {
		return this.updateById(id, _.omit(entity, [this.idFieldName]));
	}

	/**
	 * Remove an entity by ID
	 *
	 * @param {String} id
	 * @returns {Promise<any>} Return with ID of the deleted document.
	 *
	 */
	async removeById(id) {
		await this.getTable().where(this.idFieldName, id).del();
		return id;
	}

	/**
	 * Remove entities which are matched by `query`
	 *
	 * @param {Object} query
	 * @returns {Promise<Number>} Return with the number of deleted documents.
	 *
	 */
	async removeMany(query) {
		const res = await this.getTable().where(query).del();
		return res;
	}

	/**
	 * Clear all entities from collection
	 *
	 * @returns {Promise<Number>}
	 *
	 */
	async clear() {
		const count = await this.count();
		await this.getTable().truncate();
		return count;
	}

	/**
	 * Convert DB entity to JSON object.
	 *
	 * @param {Object} entity
	 * @returns {Object}
	 */
	entityToJSON(entity) {
		return entity;
	}

	/**
	 * Create a query based on filters
	 *
	 * Available filters:
	 *  - search
	 *  - searchFields
	 * 	- sort
	 * 	- limit
	 * 	- offset
	 *  - query
	 *
	 * @param {Object} params
	 * @param {Object?} opts
	 * @param {Boolean?} opts.counting
	 * @returns {Query}
	 * @memberof MemoryDbAdapter
	 */
	createQuery(params, opts = {}) {
		let q = this.getTable();
		if (opts.counting) q = q.count({ count: "*" });
		if (params) {
			const query = params.query ? Object.assign({}, params.query) : {};

			q = this.computeQuery(q, query);

			// Text search
			if (_.isString(params.search) && params.search !== "" && params.searchFields) {
				params.searchFields.forEach((field, i) => {
					const fn = i == 0 ? "where" : "orWhere";
					q = q[fn](field, "like", `%${params.search}%`);
				});
			}

			// Sort
			if (!opts.counting && params.sort) {
				let pSort = params.sort;
				if (typeof pSort == "string") pSort = [pSort];
				pSort.forEach(field => {
					if (field.startsWith("&")) q = q.orderByRaw(field.slice(1));
					else if (field.startsWith("-")) q = q.orderBy(field.slice(1), "desc");
					else q = q.orderBy(field, "asc");
				});
			}

			// Limit
			if (!opts.counting && _.isNumber(params.limit) && params.limit > 0)
				q.limit(params.limit);

			// Offset
			if (!opts.counting && _.isNumber(params.offset) && params.offset > 0) {
				if (!params.sort && this.opts.knex.client == "mssql") {
					// MSSQL can't use offset without sort.
					// https://github.com/knex/knex/issues/1527
					q = q.orderBy(this.idFieldName, "asc");
				}
				q.offset(params.offset);
			}
		}

		// If not params
		return q;
	}

	/**
	 * Compute recursive query based on operators
	 *
	 * @param {Query} q
	 * @param {Object} query
	 * @param {String?} fieldName
	 * @returns {Query}
	 * @memberof MemoryDbAdapter
	 */
	computeQuery(q, query, fieldName = '') {
		if (!query || typeof query !== "object" || Array.isArray(query)) return q;

		const assignQueryArrayElements = (builder, value, firstElementQuery = 'where', everyOtherElementQuery = '') => {
			return value.forEach((query, i) => {
				const fn = i == 0 ? firstElementQuery : (everyOtherElementQuery || firstElementQuery);
				builder[fn]((innerBuilder) => this.computeQuery(innerBuilder, query, fieldName));
			})
		}

		Object.entries(query).forEach(([key, fieldValue]) => {
			// Checking operators
			if (key === "$in" && Array.isArray(fieldValue)) { // Comparison query operators
				q = q.whereIn(fieldName, fieldValue);
			} else if (key === "$nin" && Array.isArray(fieldValue)) {
				q = q.whereNotIn(fieldName, fieldValue);
			} else if (key === "$gt") {
				q = q.where(fieldName, ">", fieldValue);
			} else if (key === "$gte") {
				q = q.where(fieldName, ">=", fieldValue);
			} else if (key === "$lt") {
				q = q.where(fieldName, "<", fieldValue);
			} else if (key === "$lte") {
				q = q.where(fieldName, "<=", fieldValue);
			} else if (key === "$eq") {
				q = q.where(fieldName, "=", fieldValue);
			} else if (key === "$ne") {
				q = q.where(fieldName, "!=", fieldValue);
			} else if (key === "$exists" && fieldValue === true) { // Element query operators
				q = q.whereNotNull(fieldName);
			} else if (key === "$exists" && fieldValue === false) {
				q = q.whereNull(fieldName);
			} else if (key === "$or" && Array.isArray(fieldValue)) { // Logical query operators
				q = q.where((builder) => assignQueryArrayElements(builder, fieldValue, 'where', 'orWhere'));
			} else if (key === "$and" && Array.isArray(fieldValue)) {
				q = q.where((builder) => assignQueryArrayElements(builder, fieldValue));
			} else if (key === "$nor" && Array.isArray(fieldValue)) {
				q = q.where((builder) => assignQueryArrayElements(builder, fieldValue, 'whereNot'));
			} else if (key === "$not") {
				if (typeof fieldValue === "object") {
					q = q.whereNot((builder) => this.computeQuery(builder, fieldValue, fieldName));
				} else {
					q = q.whereNot(fieldName, fieldValue);
				}
			} else if (key === "$raw") { // custom query operator
				if (typeof fieldValue == "string") {
					q = q.whereRaw(fieldValue);
				} else if (typeof fieldValue == "object") {
					q = q.whereRaw(fieldValue.condition, fieldValue.bindings);
				}
			} else if (typeof fieldValue === "object") { // inheritance of query operators
				q = q.where((builder) => this.computeQuery(builder, fieldValue, key));
			} else if (key === "$ilike") { // custom - `ilike`
				q = q.where(fieldName, "ilike", fieldValue);
			} else { // default operator
				q = q.where(key, fieldValue);
			}
		})

		return q;
	}

	/**
	 * Create a table based on field definitions
	 * @param {Array<Object>} fields
	 * @param {Object?} opts
	 * @param {Boolean?} opts.dropTableIfExists
	 * @param {Boolean?} opts.createIndexes
	 */
	async createTable(fields, opts = {}) {
		if (!fields) fields = this.service.$fields;

		const c = this.getSchemaClient();

		if (opts && opts.dropTableIfExists !== false) {
			const exists = await c.hasTable(this.opts.tableName);
			if (exists) {
				await this.dropTable(this.opts.tableName);
			}
		}

		this.logger.info(`Creating '${this.opts.tableName}' table...`);
		await c.createTable(this.opts.tableName, table => {
			for (const field of fields) {
				if (field.virtual) continue;

				let f;
				if (!(field.columnType in table))
					throw new Error(
						`Field '${field.columnName}' columnType '${field.columnType}' is not a valid type.`
					);

				if (field.primaryKey) {
					if (field.generated == "user") {
						f = table[field.columnType](field.columnName);
					} else {
						f = table.increments(field.columnName);
					}
					f = f.primary();
				} else {
					if (field.columnType == "string") {
						const len = field.columnLength || field.max || field.length;
						f = table.string(field.columnName, len);
					} else {
						f = table[field.columnType](field.columnName);
					}
				}
			}

			if (
				opts &&
				opts.createIndexes &&
				this.service.settings &&
				this.service.settings.indexes
			) {
				this.service.settings.indexes.forEach(def => this.createTableIndex(table, def));
			}
		});
		this.logger.info(`Table '${this.opts.tableName}' created.`);
	}

	/**
	 * Drop the given table.
	 * @param {String?} tableName
	 */
	async dropTable(tableName = this.opts.tableName) {
		this.logger.info(`Dropping '${tableName}' table...`);
		await this.getSchemaClient().dropTable(tableName);
	}

	/**
	 * Create an index.
	 *
	 * @param {Object} def
	 * @param {String|Array<String>|Object} def.fields
	 * @param {String?} def.name
	 * @param {String?} def.type The type can be optionally specified for PostgreSQL and MySQL
	 * @param {Boolean?} def.unique
	 * @returns {Promise<void>}
	 */
	async createIndex(def) {
		await this.getSchemaClient().alterTable(this.opts.tableName, table =>
			this.createTableIndex(table, def)
		);
	}

	/**
	 * Create index on the given table
	 * @param {KnexTable} table
	 * @param {Object} def
	 * @returns
	 */
	createTableIndex(table, def) {
		let fields = def.fields;
		if (_.isPlainObject(fields)) {
			fields = Object.keys(fields);
		}

		if (def.unique) return table.unique(fields, def.name);
		else return table.index(fields, def.name, def.type);
	}

	/**
	 * Remove an index.
	 *
	 * @param {Object} def
	 * @param {String|Array<String>|Object} def.fields
	 * @param {String?} def.name
	 * @returns {Promise<void>}
	 */
	async removeIndex(def) {
		let fields = def.fields;
		if (_.isPlainObject(fields)) {
			fields = Object.keys(fields);
		}

		await this.getSchemaClient().alterTable(this.opts.tableName, function (table) {
			return table.dropIndex(fields, def.name);
		});
	}
}

module.exports = KnexAdapter;
