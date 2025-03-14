import { DEBUG } from '@glimmer/env';

import { resolve } from 'rsvp';

import { assertPolymorphicType } from '@ember-data/store/-debug';

import { internalModelFactoryFor, recordIdentifierFor } from '../store/internal-model-factory';
import Reference, { internalModelForReference } from './reference';

/**
  @module @ember-data/store
*/

/**
 A `HasManyReference` is a low-level API that allows users and addon
 authors to perform meta-operations on a has-many relationship.

 @class HasManyReference
 @public
 @extends Reference
 */
export default class HasManyReference extends Reference {
  constructor(store, parentIMOrIdentifier, hasManyRelationship, key) {
    super(store, parentIMOrIdentifier);
    this.key = key;
    this.hasManyRelationship = hasManyRelationship;
    this.type = hasManyRelationship.definition.type;

    this.parent = internalModelFactoryFor(store).peek(parentIMOrIdentifier).recordReference;

    // TODO inverse
  }

  _resource() {
    return this.recordData.getHasMany(this.key);
  }

  /**
   This returns a string that represents how the reference will be
   looked up when it is loaded. If the relationship has a link it will
   use the "link" otherwise it defaults to "id".

   Example

   ```app/models/post.js
   import Model, { hasMany } from '@ember-data/model';

   export default class PostModel extends Model {
     @hasMany({ async: true }) comments;
   }
   ```

   ```javascript
   let post = store.push({
     data: {
       type: 'post',
       id: 1,
       relationships: {
         comments: {
           data: [{ type: 'comment', id: 1 }]
         }
       }
     }
   });

   let commentsRef = post.hasMany('comments');

   // get the identifier of the reference
   if (commentsRef.remoteType() === "ids") {
     let ids = commentsRef.ids();
   } else if (commentsRef.remoteType() === "link") {
     let link = commentsRef.link();
   }
   ```

   @method remoteType
   @public
   @return {String} The name of the remote type. This should either be `link` or `ids`
   */
  remoteType() {
    let value = this._resource();
    if (value && value.links && value.links.related) {
      return 'link';
    }

    return 'ids';
  }

  /**
   `ids()` returns an array of the record IDs in this relationship.

   Example

   ```app/models/post.js
   import Model, { hasMany } from '@ember-data/model';

   export default class PostModel extends Model {
     @hasMany({ async: true }) comments;
   }
   ```

   ```javascript
   let post = store.push({
     data: {
       type: 'post',
       id: 1,
       relationships: {
         comments: {
           data: [{ type: 'comment', id: 1 }]
         }
       }
     }
   });

   let commentsRef = post.hasMany('comments');

   commentsRef.ids(); // ['1']
   ```

   @method ids
    @public
   @return {Array} The ids in this has-many relationship
   */
  ids() {
    let resource = this._resource();

    let ids = [];
    if (resource.data) {
      ids = resource.data.map((data) => data.id);
    }

    return ids;
  }

  /**
   `push` can be used to update the data in the relationship and Ember
   Data will treat the new data as the canonical value of this
   relationship on the backend.

   Example

   ```app/models/post.js
   import Model, { hasMany } from '@ember-data/model';

   export default class PostModel extends Model {
     @hasMany({ async: true }) comments;
   }
   ```

   ```
   let post = store.push({
     data: {
       type: 'post',
       id: 1,
       relationships: {
         comments: {
           data: [{ type: 'comment', id: 1 }]
         }
       }
     }
   });

   let commentsRef = post.hasMany('comments');

   commentsRef.ids(); // ['1']

   commentsRef.push([
   [{ type: 'comment', id: 2 }],
   [{ type: 'comment', id: 3 }],
   ])

   commentsRef.ids(); // ['2', '3']
   ```

   @method push
    @public
   @param {Array|Promise} objectOrPromise a promise that resolves to a JSONAPI document object describing the new value of this relationship.
   @return {ManyArray}
   */
  push(objectOrPromise) {
    return resolve(objectOrPromise).then((payload) => {
      let array = payload;

      if (typeof payload === 'object' && payload.data) {
        array = payload.data;
      }

      let internalModel = internalModelForReference(this);

      let identifiers = array.map((obj) => {
        let record = this.store.push(obj);

        if (DEBUG) {
          let relationshipMeta = this.hasManyRelationship.definition;
          assertPolymorphicType(
            internalModel.identifier,
            relationshipMeta,
            record._internalModel.identifier,
            this.store
          );
        }
        return recordIdentifierFor(record);
      });

      const { graph, identifier } = this.hasManyRelationship;
      this.store._backburner.join(() => {
        graph.push({
          op: 'replaceRelatedRecords',
          record: identifier,
          field: this.key,
          value: identifiers,
        });
      });

      return internalModel.getHasMany(this.key);
      // TODO IGOR it seems wrong that we were returning the many array here
      //return this.hasManyRelationship.manyArray;
    });
  }

  _isLoaded() {
    let hasRelationshipDataProperty = this.hasManyRelationship.state.hasReceivedData;
    if (!hasRelationshipDataProperty) {
      return false;
    }

    let members = this.hasManyRelationship.currentState;

    //TODO Igor cleanup
    return members.every((identifier) => {
      let internalModel = this.store._internalModelForResource(identifier);
      return internalModel.currentState.isLoaded === true;
    });
  }

  /**
   `value()` synchronously returns the current value of the has-many
   relationship. Unlike `record.get('relationshipName')`, calling
   `value()` on a reference does not trigger a fetch if the async
   relationship is not yet loaded. If the relationship is not loaded
   it will always return `null`.

   Example

   ```app/models/post.js
   import Model, { hasMany } from '@ember-data/model';

   export default class PostModel extends Model {
     @hasMany({ async: true }) comments;
   }
   ```

   ```javascript
   let post = store.push({
     data: {
       type: 'post',
       id: 1,
       relationships: {
         comments: {
           data: [{ type: 'comment', id: 1 }]
         }
       }
     }
   });

   let commentsRef = post.hasMany('comments');

   post.get('comments').then(function(comments) {
     commentsRef.value() === comments
   })
   ```

   @method value
    @public
   @return {ManyArray}
   */
  value() {
    let internalModel = internalModelForReference(this);
    if (this._isLoaded()) {
      return internalModel.getManyArray(this.key);
    }

    return null;
  }

  /**
   Loads the relationship if it is not already loaded.  If the
   relationship is already loaded this method does not trigger a new
   load. This causes a request to the specified
   relationship link or reloads all items currently in the relationship.

   Example

   ```app/models/post.js
   import Model, { hasMany } from '@ember-data/model';

   export default class PostModel extends Model {
     @hasMany({ async: true }) comments;
   }
   ```

   ```javascript
   let post = store.push({
     data: {
       type: 'post',
       id: 1,
       relationships: {
         comments: {
           data: [{ type: 'comment', id: 1 }]
         }
       }
     }
   });

   let commentsRef = post.hasMany('comments');

   commentsRef.load().then(function(comments) {
     //...
   });
   ```

   You may also pass in an options object whose properties will be
   fed forward. This enables you to pass `adapterOptions` into the
   request given to the adapter via the reference.

   Example

   ```javascript
   commentsRef.load({ adapterOptions: { isPrivate: true } })
     .then(function(comments) {
       //...
     });
   ```

   ```app/adapters/comment.js
   export default ApplicationAdapter.extend({
     findMany(store, type, id, snapshots) {
       // In the adapter you will have access to adapterOptions.
       let adapterOptions = snapshots[0].adapterOptions;
     }
   });
   ```

   @method load
    @public
   @param {Object} options the options to pass in.
   @return {Promise} a promise that resolves with the ManyArray in
   this has-many relationship.
   */
  load(options) {
    let internalModel = internalModelForReference(this);
    return internalModel.getHasMany(this.key, options);
  }

  /**
   Reloads this has-many relationship. This causes a request to the specified
   relationship link or reloads all items currently in the relationship.

   Example

   ```app/models/post.js
   import Model, { hasMany } from '@ember-data/model';

   export default class PostModel extends Model {
     @hasMany({ async: true }) comments;
   }
   ```

   ```javascript
   let post = store.push({
     data: {
       type: 'post',
       id: 1,
       relationships: {
         comments: {
           data: [{ type: 'comment', id: 1 }]
         }
       }
     }
   });

   let commentsRef = post.hasMany('comments');

   commentsRef.reload().then(function(comments) {
     //...
   });
   ```

   You may also pass in an options object whose properties will be
   fed forward. This enables you to pass `adapterOptions` into the
   request given to the adapter via the reference. A full example
   can be found in the `load` method.

   Example

   ```javascript
   commentsRef.reload({ adapterOptions: { isPrivate: true } })
   ```

   @method reload
    @public
   @param {Object} options the options to pass in.
   @return {Promise} a promise that resolves with the ManyArray in this has-many relationship.
   */
  reload(options) {
    let internalModel = internalModelForReference(this);
    return internalModel.reloadHasMany(this.key, options);
  }
}
