import EmberObject from '@ember/object';
import { run } from '@ember/runloop';
import Ember from 'ember';

import { module, test } from 'qunit';
import { Promise as EmberPromise, resolve } from 'rsvp';

import DS from 'ember-data';
import { setupTest } from 'ember-qunit';

import { deprecatedTest } from '@ember-data/unpublished-test-infra/test-support/deprecated-test';
import testInDebug from '@ember-data/unpublished-test-infra/test-support/test-in-debug';

let store, Person, PhoneNumber, Post;
const { attr, hasMany, belongsTo } = DS;

module('unit/store/push - DS.Store#push', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    Person = DS.Model.extend({
      firstName: attr('string'),
      lastName: attr('string'),
      phoneNumbers: hasMany('phone-number', { async: false }),
      friends: hasMany('person', { async: false, inverse: 'friends' }), // many to many
    });

    PhoneNumber = DS.Model.extend({
      number: attr('string'),
      person: belongsTo('person', { async: false }),
    });

    Post = DS.Model.extend({
      postTitle: attr('string'),
    });

    this.owner.register('model:person', Person);
    this.owner.register('model:phone-number', PhoneNumber);
    this.owner.register('model:post', Post);

    store = this.owner.lookup('service:store');

    this.owner.register('serializer:application', DS.JSONAPISerializer.extend());
    this.owner.register('serializer:post', DS.RESTSerializer.extend());
  });

  test('Changed attributes are reset when matching data is pushed', function (assert) {
    let person = run(() => {
      return store.push({
        data: {
          type: 'person',
          id: 1,
          attributes: {
            firstName: 'original first name',
          },
        },
      });
    });

    assert.strictEqual(person.get('firstName'), 'original first name');
    assert.strictEqual(person.get('currentState.stateName'), 'root.loaded.saved');

    run(() => person.set('firstName', 'updated first name'));

    assert.strictEqual(person.get('firstName'), 'updated first name');
    assert.strictEqual(person.get('lastName'), undefined);
    assert.strictEqual(person.get('currentState.stateName'), 'root.loaded.updated.uncommitted');
    assert.deepEqual(person.changedAttributes().firstName, ['original first name', 'updated first name']);

    run(() => {
      store.push({
        data: {
          type: 'person',
          id: 1,
          attributes: {
            firstName: 'updated first name',
          },
        },
      });
    });

    assert.strictEqual(person.get('firstName'), 'updated first name');
    assert.strictEqual(person.get('currentState.stateName'), 'root.loaded.saved');
    assert.notOk(person.changedAttributes().firstName);
  });

  test('Calling push with a normalized hash returns a record', function (assert) {
    assert.expect(2);

    let adapter = store.adapterFor('application');

    adapter.shouldBackgroundReloadRecord = () => false;

    return run(() => {
      let person = store.push({
        data: {
          type: 'person',
          id: 'wat',
          attributes: {
            firstName: 'Yehuda',
            lastName: 'Katz',
          },
        },
      });

      return store.findRecord('person', 'wat').then((foundPerson) => {
        assert.strictEqual(
          foundPerson,
          person,
          'record returned via load() is the same as the record returned from findRecord()'
        );
        assert.deepEqual(foundPerson.getProperties('id', 'firstName', 'lastName'), {
          id: 'wat',
          firstName: 'Yehuda',
          lastName: 'Katz',
        });
      });
    });
  });

  test('Supplying a model class for `push` is the same as supplying a string', function (assert) {
    assert.expect(1);

    let adapter = store.adapterFor('application');

    adapter.shouldBackgroundReloadRecord = () => false;

    const Programmer = Person.extend();
    this.owner.register('model:programmer', Programmer);

    return run(() => {
      store.push({
        data: {
          type: 'programmer',
          id: 'wat',
          attributes: {
            firstName: 'Yehuda',
            lastName: 'Katz',
          },
        },
      });

      return store.findRecord('programmer', 'wat').then((foundProgrammer) => {
        assert.deepEqual(foundProgrammer.getProperties('id', 'firstName', 'lastName'), {
          id: 'wat',
          firstName: 'Yehuda',
          lastName: 'Katz',
        });
      });
    });
  });

  deprecatedTest(
    `Calling push triggers 'didLoad' even if the record hasn't been requested from the adapter`,
    {
      id: 'ember-data:record-lifecycle-event-methods',
      until: '4.0',
    },
    async function (assert) {
      assert.expect(1);

      let didLoad = new EmberPromise((resolve, reject) => {
        Person.reopen({
          didLoad() {
            try {
              assert.ok(true, 'The didLoad callback was called');
              resolve();
            } catch (e) {
              reject(e);
            }
          },
        });
      });

      run(() => {
        store.push({
          data: {
            type: 'person',
            id: 'wat',
            attributes: {
              firstName: 'Yehuda',
              lastName: 'Katz',
            },
          },
        });
      });

      await didLoad;
    }
  );

  test('Calling push with partial records updates just those attributes', function (assert) {
    assert.expect(2);

    let adapter = store.adapterFor('application');

    adapter.shouldBackgroundReloadRecord = () => false;

    return run(() => {
      store.push({
        data: {
          type: 'person',
          id: 'wat',
          attributes: {
            firstName: 'Yehuda',
            lastName: 'Katz',
          },
        },
      });

      let person = store.peekRecord('person', 'wat');

      store.push({
        data: {
          type: 'person',
          id: 'wat',
          attributes: {
            lastName: 'Katz!',
          },
        },
      });

      return store.findRecord('person', 'wat').then((foundPerson) => {
        assert.strictEqual(
          foundPerson,
          person,
          'record returned via load() is the same as the record returned from findRecord()'
        );
        assert.deepEqual(foundPerson.getProperties('id', 'firstName', 'lastName'), {
          id: 'wat',
          firstName: 'Yehuda',
          lastName: 'Katz!',
        });
      });
    });
  });

  test('Calling push on normalize allows partial updates with raw JSON', function (assert) {
    this.owner.register('serializer:person', DS.RESTSerializer);
    let person;

    run(() => {
      person = store.push({
        data: {
          type: 'person',
          id: '1',
          attributes: {
            firstName: 'Robert',
            lastName: 'Jackson',
          },
        },
      });

      store.push(
        store.normalize('person', {
          id: '1',
          firstName: 'Jacquie',
        })
      );
    });

    assert.strictEqual(person.get('firstName'), 'Jacquie', 'you can push raw JSON into the store');
    assert.strictEqual(person.get('lastName'), 'Jackson', 'existing fields are untouched');
  });

  test('Calling push with a normalized hash containing IDs of related records returns a record', function (assert) {
    assert.expect(1);

    Person.reopen({
      phoneNumbers: hasMany('phone-number', {
        async: true,
      }),
    });

    let adapter = store.adapterFor('application');

    adapter.findRecord = function (store, type, id) {
      if (id === '1') {
        return resolve({
          data: {
            id: 1,
            type: 'phone-number',
            attributes: { number: '5551212' },
            relationships: {
              person: {
                data: { id: 'wat', type: 'person' },
              },
            },
          },
        });
      }

      if (id === '2') {
        return resolve({
          data: {
            id: 2,
            type: 'phone-number',
            attributes: { number: '5552121' },
            relationships: {
              person: {
                data: { id: 'wat', type: 'person' },
              },
            },
          },
        });
      }
    };

    return run(() => {
      let normalized = store.normalize('person', {
        id: 'wat',
        type: 'person',
        attributes: {
          'first-name': 'John',
          'last-name': 'Smith',
        },
        relationships: {
          'phone-numbers': {
            data: [
              { id: 1, type: 'phone-number' },
              { id: 2, type: 'phone-number' },
            ],
          },
        },
      });
      let person = store.push(normalized);

      return person.get('phoneNumbers').then((phoneNumbers) => {
        let items = phoneNumbers.map((item) => {
          return item ? item.getProperties('id', 'number', 'person') : null;
        });
        assert.deepEqual(items, [
          {
            id: '1',
            number: '5551212',
            person: person,
          },
          {
            id: '2',
            number: '5552121',
            person: person,
          },
        ]);
      });
    });
  });

  test('Calling pushPayload allows pushing raw JSON', function (assert) {
    run(() => {
      store.pushPayload('post', {
        posts: [
          {
            id: '1',
            postTitle: 'Ember rocks',
          },
        ],
      });
    });

    let post = store.peekRecord('post', 1);

    assert.strictEqual(post.get('postTitle'), 'Ember rocks', 'you can push raw JSON into the store');

    run(() => {
      store.pushPayload('post', {
        posts: [
          {
            id: '1',
            postTitle: 'Ember rocks (updated)',
          },
        ],
      });
    });

    assert.strictEqual(post.get('postTitle'), 'Ember rocks (updated)', 'You can update data in the store');
  });

  test('Calling pushPayload allows pushing singular payload properties', function (assert) {
    run(() => {
      store.pushPayload('post', {
        post: {
          id: '1',
          postTitle: 'Ember rocks',
        },
      });
    });

    let post = store.peekRecord('post', 1);

    assert.strictEqual(post.get('postTitle'), 'Ember rocks', 'you can push raw JSON into the store');

    run(() => {
      store.pushPayload('post', {
        post: {
          id: '1',
          postTitle: 'Ember rocks (updated)',
        },
      });
    });

    assert.strictEqual(post.get('postTitle'), 'Ember rocks (updated)', 'You can update data in the store');
  });

  test(`Calling pushPayload should use the type's serializer for normalizing`, function (assert) {
    assert.expect(4);

    this.owner.register(
      'serializer:post',
      DS.RESTSerializer.extend({
        normalize() {
          assert.ok(true, 'normalized is called on Post serializer');
          return this._super(...arguments);
        },
      })
    );

    this.owner.register(
      'serializer:person',
      DS.RESTSerializer.extend({
        normalize() {
          assert.ok(true, 'normalized is called on Person serializer');
          return this._super(...arguments);
        },
      })
    );

    run(() => {
      store.pushPayload('post', {
        posts: [
          {
            id: 1,
            postTitle: 'Ember rocks',
          },
        ],
        people: [
          {
            id: 2,
            firstName: 'Yehuda',
          },
        ],
      });
    });

    let post = store.peekRecord('post', 1);

    assert.strictEqual(post.get('postTitle'), 'Ember rocks', 'you can push raw JSON into the store');

    let person = store.peekRecord('person', 2);

    assert.strictEqual(person.get('firstName'), 'Yehuda', 'you can push raw JSON into the store');
  });

  test(`Calling pushPayload without a type uses application serializer's pushPayload method`, function (assert) {
    assert.expect(1);

    this.owner.register(
      'serializer:application',
      DS.RESTSerializer.extend({
        pushPayload() {
          assert.ok(true, `pushPayload is called on Application serializer`);
          return this._super(...arguments);
        },
      })
    );

    run(() => {
      store.pushPayload({
        posts: [{ id: '1', postTitle: 'Ember rocks' }],
      });
    });
  });

  test(`Calling pushPayload without a type should use a model's serializer when normalizing`, function (assert) {
    assert.expect(4);

    this.owner.register(
      'serializer:post',
      DS.RESTSerializer.extend({
        normalize() {
          assert.ok(true, 'normalized is called on Post serializer');
          return this._super(...arguments);
        },
      })
    );

    this.owner.register(
      'serializer:application',
      DS.RESTSerializer.extend({
        normalize() {
          assert.ok(true, 'normalized is called on Application serializer');
          return this._super(...arguments);
        },
      })
    );

    run(() => {
      store.pushPayload({
        posts: [
          {
            id: '1',
            postTitle: 'Ember rocks',
          },
        ],
        people: [
          {
            id: '2',
            firstName: 'Yehuda',
          },
        ],
      });
    });

    var post = store.peekRecord('post', 1);

    assert.strictEqual(post.get('postTitle'), 'Ember rocks', 'you can push raw JSON into the store');

    var person = store.peekRecord('person', 2);

    assert.strictEqual(person.get('firstName'), 'Yehuda', 'you can push raw JSON into the store');
  });

  test('Calling pushPayload allows partial updates with raw JSON', function (assert) {
    this.owner.register('serializer:person', DS.RESTSerializer);

    run(() => {
      store.pushPayload('person', {
        people: [
          {
            id: '1',
            firstName: 'Robert',
            lastName: 'Jackson',
          },
        ],
      });
    });

    let person = store.peekRecord('person', 1);

    assert.strictEqual(person.get('firstName'), 'Robert', 'you can push raw JSON into the store');
    assert.strictEqual(person.get('lastName'), 'Jackson', 'you can push raw JSON into the store');

    run(() => {
      store.pushPayload('person', {
        people: [
          {
            id: '1',
            firstName: 'Jacquie',
          },
        ],
      });
    });

    assert.strictEqual(person.get('firstName'), 'Jacquie', 'you can push raw JSON into the store');
    assert.strictEqual(person.get('lastName'), 'Jackson', 'existing fields are untouched');
  });

  testInDebug(
    'Calling pushPayload with a record does not reorder the hasMany it is in when a many-many relationship',
    function (assert) {
      // one person with two friends
      // if we push a change to a friend, the
      // person's friends should be in the same order
      // at the end

      store.pushPayload({
        data: [
          {
            id: '1',
            type: 'person',
            attributes: {
              'first-name': 'Robert',
              'last-name': 'Jackson',
            },
            relationships: {
              friends: {
                data: [
                  { id: '2', type: 'person' },
                  { id: '3', type: 'person' },
                ],
              },
            },
          },
        ],
        included: [
          {
            id: '2',
            type: 'person',
            attributes: {
              'first-name': 'Friend',
              'last-name': 'One',
            },
          },
          {
            id: '3',
            type: 'person',
            attributes: {
              'first-name': 'Friend',
              'last-name': 'Two',
            },
          },
        ],
      });

      store.pushPayload({
        data: [
          {
            id: '2',
            type: 'person',
            relationships: {
              friends: {
                data: [{ id: '1', type: 'person' }],
              },
            },
          },
        ],
      });

      let robert = store.peekRecord('person', '1');

      var friends = robert.friends;
      assert.strictEqual(friends.firstObject.id, '2', 'first object is unchanged');
      assert.strictEqual(friends.lastObject.id, '3', 'last object is unchanged');
    }
  );

  testInDebug('calling push without data argument as an object raises an error', function (assert) {
    let invalidValues = [null, 1, 'string', EmberObject.create(), EmberObject.extend(), true];

    assert.expect(invalidValues.length);

    invalidValues.forEach((invalidValue) => {
      assert.expectAssertion(() => {
        run(() => {
          store.push('person', invalidValue);
        });
      }, /object/);
    });
  });

  testInDebug('Calling push with a link for a non async relationship should warn if no data', function (assert) {
    Person.reopen({
      phoneNumbers: hasMany('phone-number', { async: false }),
    });

    assert.expectWarning(() => {
      run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            relationships: {
              phoneNumbers: {
                links: {
                  related: '/api/people/1/phone-numbers',
                },
              },
            },
          },
        });
      });
    }, /You pushed a record of type 'person' with a relationship 'phoneNumbers' configured as 'async: false'. You've included a link but no primary data, this may be an error in your payload. EmberData will treat this relationship as known-to-be-empty./);
  });

  testInDebug(
    'Calling push with a link for a non async relationship should not warn when data is present',
    function (assert) {
      Person.reopen({
        phoneNumbers: hasMany('phone-number', { async: false }),
      });

      assert.expectNoWarning(() => {
        run(() => {
          store.push({
            data: {
              type: 'person',
              id: '1',
              relationships: {
                phoneNumbers: {
                  data: [
                    { type: 'phone-number', id: '2' },
                    { type: 'phone-number', id: '3' },
                  ],
                  links: {
                    related: '/api/people/1/phone-numbers',
                  },
                },
              },
            },
          });
        });
      });
    }
  );

  testInDebug(
    'Calling push with a link for a non async relationship should not reset an existing relationship',
    function (assert) {
      // GET /persons/1?include=phone-numbers
      store.push({
        data: {
          type: 'person',
          id: '1',
          relationships: {
            phoneNumbers: {
              data: [{ type: 'phone-number', id: '2' }],
              links: {
                related: '/api/people/1/phone-numbers',
              },
            },
          },
        },
        included: [
          {
            type: 'phone-number',
            id: '2',
            attributes: {
              number: '1-800-DATA',
            },
          },
        ],
      });

      let person = store.peekRecord('person', 1);

      assert.strictEqual(person.get('phoneNumbers.length'), 1);
      assert.strictEqual(person.get('phoneNumbers.firstObject.number'), '1-800-DATA');

      // GET /persons/1
      assert.expectNoWarning(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            relationships: {
              phoneNumbers: {
                links: {
                  related: '/api/people/1/phone-numbers',
                },
              },
            },
          },
        });
      });

      assert.strictEqual(person.get('phoneNumbers.length'), 1);
      assert.strictEqual(person.get('phoneNumbers.firstObject.number'), '1-800-DATA');
    }
  );

  testInDebug('Calling push with an unknown model name throws an assertion error', function (assert) {
    assert.expectAssertion(() => {
      run(() => {
        store.push({
          data: {
            id: '1',
            type: 'unknown',
          },
        });
      });
    }, /You tried to push data with a type 'unknown' but no model could be found with that name/);
  });

  test('Calling push with a link containing an object', function (assert) {
    Person.reopen({
      phoneNumbers: hasMany('phone-number', { async: true }),
    });

    run(() => {
      store.push(
        store.normalize('person', {
          id: '1',
          type: 'person',
          attributes: {
            'first-name': 'Tan',
          },
          relationships: {
            'phone-numbers': {
              links: { related: '/api/people/1/phone-numbers' },
            },
          },
        })
      );
    });

    let person = store.peekRecord('person', 1);

    assert.strictEqual(person.get('firstName'), 'Tan', 'you can use links containing an object');
  });

  test('Calling push with a link containing the value null', function (assert) {
    run(() => {
      store.push(
        store.normalize('person', {
          id: '1',
          type: 'person',
          attributes: {
            'first-name': 'Tan',
          },
          relationships: {
            'phone-numbers': {
              links: {
                related: null,
              },
            },
          },
        })
      );
    });

    let person = store.peekRecord('person', 1);

    assert.strictEqual(person.get('firstName'), 'Tan', 'you can use links that contain null as a value');
  });

  testInDebug('calling push with hasMany relationship the value must be an array', function (assert) {
    assert.expectAssertion(() => {
      run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            relationships: {
              phoneNumbers: {
                data: 1,
              },
            },
          },
        });
      });
    });
  });

  testInDebug('calling push with missing or invalid `id` throws assertion error', function (assert) {
    let invalidValues = [{}, { id: null }, { id: '' }];

    assert.expect(invalidValues.length);

    invalidValues.forEach((invalidValue) => {
      assert.expectAssertion(() => {
        run(() => {
          store.push({
            data: invalidValue,
          });
        });
      }, /You must include an 'id'/);
    });
  });

  testInDebug('calling push with belongsTo relationship the value must not be an array', function (assert) {
    assert.expectAssertion(() => {
      run(() => {
        store.push({
          data: {
            type: 'phone-number',
            id: '1',
            relationships: {
              person: {
                data: [1],
              },
            },
          },
        });
      });
    }, /must not be an array/);
  });

  testInDebug('Enabling Ember.ENV.DS_WARN_ON_UNKNOWN_KEYS should warn on unknown attributes', function (assert) {
    run(() => {
      let originalFlagValue = Ember.ENV.DS_WARN_ON_UNKNOWN_KEYS;
      try {
        Ember.ENV.DS_WARN_ON_UNKNOWN_KEYS = true;
        assert.expectWarning(() => {
          store.push({
            data: {
              type: 'person',
              id: '1',
              attributes: {
                firstName: 'Tomster',
                emailAddress: 'tomster@emberjs.com',
                isMascot: true,
              },
            },
          });
        }, `The payload for 'person' contains these unknown attributes: emailAddress,isMascot. Make sure they've been defined in your model.`);
      } finally {
        Ember.ENV.DS_WARN_ON_UNKNOWN_KEYS = originalFlagValue;
      }
    });
  });

  testInDebug('Enabling Ember.ENV.DS_WARN_ON_UNKNOWN_KEYS should warn on unknown relationships', function (assert) {
    run(() => {
      var originalFlagValue = Ember.ENV.DS_WARN_ON_UNKNOWN_KEYS;
      try {
        Ember.ENV.DS_WARN_ON_UNKNOWN_KEYS = true;
        assert.expectWarning(() => {
          store.push({
            data: {
              type: 'person',
              id: '1',
              relationships: {
                phoneNumbers: {},
                emailAddresses: {},
                mascots: {},
              },
            },
          });
        }, `The payload for 'person' contains these unknown relationships: emailAddresses,mascots. Make sure they've been defined in your model.`);
      } finally {
        Ember.ENV.DS_WARN_ON_UNKNOWN_KEYS = originalFlagValue;
      }
    });
  });

  testInDebug('Calling push with unknown keys should not warn by default', function (assert) {
    assert.expectNoWarning(() => {
      run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            attributes: {
              firstName: 'Tomster',
              emailAddress: 'tomster@emberjs.com',
              isMascot: true,
            },
          },
        });
      });
    }, /The payload for 'person' contains these unknown .*: .* Make sure they've been defined in your model./);
  });

  test('_push returns an instance of InternalModel if an object is pushed', function (assert) {
    let pushResult;

    run(() => {
      pushResult = store._push({
        data: {
          id: 1,
          type: 'person',
        },
      });
    });

    assert.ok(pushResult instanceof DS.InternalModel);
    assert.notOk(pushResult.record, 'InternalModel is not materialized');
  });

  test('_push does not require a modelName to resolve to a modelClass', function (assert) {
    let originalCall = store.modelFor;
    store.modelFor = function () {
      assert.notOk('modelFor was triggered as a result of a call to store._push');
    };

    run(() => {
      store._push({
        data: {
          id: 1,
          type: 'person',
        },
      });
    });

    store.modelFor = originalCall;
    assert.ok('We made it');
  });

  test('_push returns an array of InternalModels if an array is pushed', function (assert) {
    let pushResult;

    run(() => {
      pushResult = store._push({
        data: [
          {
            id: 1,
            type: 'person',
          },
        ],
      });
    });

    assert.ok(pushResult instanceof Array);
    assert.ok(pushResult[0] instanceof DS.InternalModel);
    assert.notOk(pushResult[0].record, 'InternalModel is not materialized');
  });

  test('_push returns null if no data is pushed', function (assert) {
    let pushResult;

    run(() => {
      pushResult = store._push({
        data: null,
      });
    });

    assert.strictEqual(pushResult, null);
  });
});

module('unit/store/push - DS.Store#push with JSON-API', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    const Person = DS.Model.extend({
      name: DS.attr('string'),
      cars: DS.hasMany('car', { async: false }),
    });

    const Car = DS.Model.extend({
      make: DS.attr('string'),
      model: DS.attr('string'),
      person: DS.belongsTo('person', { async: false }),
    });

    this.owner.register('model:person', Person);
    this.owner.register('model:car', Car);

    this.owner.register('adapter:application', DS.Adapter.extend());
    this.owner.register('serializer:application', DS.JSONAPISerializer.extend());

    store = this.owner.lookup('service:store');
  });

  test('Should support pushing multiple models into the store', function (assert) {
    assert.expect(2);

    run(() => {
      store.push({
        data: [
          {
            type: 'person',
            id: 1,
            attributes: {
              name: 'Tom Dale',
            },
          },
          {
            type: 'person',
            id: 2,
            attributes: {
              name: 'Tomster',
            },
          },
        ],
      });
    });

    let tom = store.peekRecord('person', 1);
    assert.strictEqual(tom.get('name'), 'Tom Dale', 'Tom should be in the store');

    let tomster = store.peekRecord('person', 2);
    assert.strictEqual(tomster.get('name'), 'Tomster', 'Tomster should be in the store');
  });

  test('Should support pushing included models into the store', function (assert) {
    assert.expect(2);

    run(() => {
      store.push({
        data: [
          {
            type: 'person',
            id: 1,
            attributes: {
              name: 'Tomster',
            },
            relationships: {
              cars: [
                {
                  data: {
                    type: 'person',
                    id: 1,
                  },
                },
              ],
            },
          },
        ],
        included: [
          {
            type: 'car',
            id: 1,
            attributes: {
              make: 'Dodge',
              model: 'Neon',
            },
            relationships: {
              person: {
                data: {
                  id: 1,
                  type: 'person',
                },
              },
            },
          },
        ],
      });
    });

    let tomster = store.peekRecord('person', 1);
    assert.strictEqual(tomster.get('name'), 'Tomster', 'Tomster should be in the store');

    let car = store.peekRecord('car', 1);
    assert.strictEqual(car.get('model'), 'Neon', "Tomster's car should be in the store");
  });
});
