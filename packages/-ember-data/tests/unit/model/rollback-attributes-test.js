import { addObserver } from '@ember/object/observers';
import { later, run } from '@ember/runloop';
import { settled } from '@ember/test-helpers';
import { isPresent } from '@ember/utils';

import { module, test } from 'qunit';
import { Promise as EmberPromise, reject } from 'rsvp';

import DS from 'ember-data';
import { setupTest } from 'ember-qunit';

import Adapter from '@ember-data/adapter';
import { InvalidError } from '@ember-data/adapter/error';
import RESTAdapter from '@ember-data/adapter/rest';
import Model, { attr } from '@ember-data/model';
import { DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS } from '@ember-data/private-build-infra/deprecations';
import JSONAPISerializer from '@ember-data/serializer/json-api';
import RESTSerializer from '@ember-data/serializer/rest';

module('unit/model/rollbackAttributes - model.rollbackAttributes()', function (hooks) {
  setupTest(hooks);

  module('rolledBack hook', function (hooks) {
    hooks.beforeEach(function () {
      const Person = DS.Model.extend({
        firstName: DS.attr(),
        lastName: DS.attr(),
        rolledBackCount: 0,
        rolledBack() {
          this.incrementProperty('rolledBackCount');
        },
      });
      Person.reopenClass({
        toString() {
          return 'Person';
        },
      });

      this.owner.register('model:person', Person);
      this.owner.register('adapter:application', Adapter.extend());
      this.owner.register('serializer:application', JSONAPISerializer.extend());
    });
    hooks.afterEach(function (assert) {
      assert.expectDeprecation({
        id: 'ember-data:record-lifecycle-event-methods',
      });
    });

    test('changes to attributes can be rolled back', function (assert) {
      let store = this.owner.lookup('service:store');
      let person;

      run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            attributes: {
              firstName: 'Tom',
              lastName: 'Dale',
            },
          },
        });
        person = store.peekRecord('person', 1);
        person.set('firstName', 'Thomas');
        return person;
      });

      assert.strictEqual(person.get('firstName'), 'Thomas', 'PreCond: we mutated firstName');
      if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
        assert.strictEqual(person.get('rolledBackCount'), 0, 'PreCond: we have not yet rolled back');
      }

      run(() => person.rollbackAttributes());

      assert.strictEqual(person.get('firstName'), 'Tom', 'We rolled back firstName');
      assert.false(person.get('hasDirtyAttributes'), 'We expect the record to be clean');

      if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
        assert.strictEqual(person.get('rolledBackCount'), 1, 'We rolled back once');
      }
    });

    test('changes to unassigned attributes can be rolled back', function (assert) {
      let store = this.owner.lookup('service:store');
      let person;

      run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            attributes: {
              lastName: 'Dale',
            },
          },
        });
        person = store.peekRecord('person', 1);
        person.set('firstName', 'Thomas');

        return person;
      });

      assert.strictEqual(person.get('firstName'), 'Thomas');
      if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
        assert.strictEqual(person.get('rolledBackCount'), 0);
      }

      run(() => person.rollbackAttributes());

      assert.strictEqual(person.get('firstName'), undefined);
      assert.false(person.get('hasDirtyAttributes'));

      if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
        assert.strictEqual(person.get('rolledBackCount'), 1);
      }
    });

    test('changes to attributes made after a record is in-flight only rolls back the local changes', function (assert) {
      let store = this.owner.lookup('service:store');
      let adapter = store.adapterFor('application');

      adapter.updateRecord = function (store, type, snapshot) {
        // Make sure the save is async
        return new EmberPromise((resolve) => later(null, resolve, 15));
      };

      let person = run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            attributes: {
              firstName: 'Tom',
              lastName: 'Dale',
            },
          },
        });

        let person = store.peekRecord('person', 1);
        person.set('firstName', 'Thomas');

        return person;
      });

      return run(() => {
        let saving = person.save();

        assert.strictEqual(person.get('firstName'), 'Thomas');

        person.set('lastName', 'Dolly');

        assert.strictEqual(person.get('lastName'), 'Dolly');
        if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
          assert.strictEqual(person.get('rolledBackCount'), 0);
        }

        person.rollbackAttributes();

        assert.strictEqual(person.get('firstName'), 'Thomas');
        assert.strictEqual(person.get('lastName'), 'Dale');
        assert.true(person.get('isSaving'));

        return saving.then(() => {
          if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
            assert.strictEqual(person.get('rolledBackCount'), 1);
          }
          assert.false(person.get('hasDirtyAttributes'), 'The person is now clean');
        });
      });
    });

    test("a record's changes can be made if it fails to save", function (assert) {
      let store = this.owner.lookup('service:store');
      let adapter = store.adapterFor('application');

      adapter.updateRecord = function (store, type, snapshot) {
        return reject();
      };

      let person = run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            attributes: {
              firstName: 'Tom',
              lastName: 'Dale',
            },
          },
        });

        let person = store.peekRecord('person', 1);
        person.set('firstName', 'Thomas');

        return person;
      });

      assert.deepEqual(person.changedAttributes().firstName, ['Tom', 'Thomas']);

      run(function () {
        person.save().then(null, function () {
          assert.true(person.get('isError'));
          assert.deepEqual(person.changedAttributes().firstName, ['Tom', 'Thomas']);
          if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
            assert.strictEqual(person.get('rolledBackCount'), 0);
          }
          run(function () {
            person.rollbackAttributes();
          });

          assert.strictEqual(person.get('firstName'), 'Tom');
          assert.false(person.get('isError'));
          assert.strictEqual(Object.keys(person.changedAttributes()).length, 0);
          if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
            assert.strictEqual(person.get('rolledBackCount'), 1);
          }
        });
      });
    });

    test(`a deleted record's attributes can be rollbacked if it fails to save, record arrays are updated accordingly`, function (assert) {
      let store = this.owner.lookup('service:store');
      let adapter = store.adapterFor('application');

      adapter.deleteRecord = function (store, type, snapshot) {
        return reject();
      };

      let person, people;

      run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
            attributes: {
              firstName: 'Tom',
              lastName: 'Dale',
            },
          },
        });
        person = store.peekRecord('person', 1);
        people = store.peekAll('person');
      });

      run(() => person.deleteRecord());

      assert.strictEqual(people.get('length'), 1, 'a deleted record appears in record array until it is saved');
      assert.strictEqual(people.objectAt(0), person, 'a deleted record appears in record array until it is saved');

      return run(() => {
        return person
          .save()
          .catch(() => {
            assert.true(person.get('isError'));
            assert.true(person.get('isDeleted'));
            if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
              assert.strictEqual(person.get('rolledBackCount'), 0);
            }

            run(() => person.rollbackAttributes());

            assert.false(person.get('isDeleted'));
            assert.false(person.get('isError'));
            assert.false(person.get('hasDirtyAttributes'), 'must be not dirty');
            if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
              assert.strictEqual(person.get('rolledBackCount'), 1);
            }
          })
          .then(() => {
            assert.strictEqual(
              people.get('length'),
              1,
              'the underlying record array is updated accordingly in an asynchronous way'
            );
          });
      });
    });

    test(`new record's attributes can be rollbacked`, function (assert) {
      let store = this.owner.lookup('service:store');
      let person = store.createRecord('person', { id: 1 });

      assert.true(person.get('isNew'), 'must be new');
      assert.true(person.get('hasDirtyAttributes'), 'must be dirty');
      if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
        assert.strictEqual(person.get('rolledBackCount'), 0);
      }

      run(person, 'rollbackAttributes');

      assert.false(person.get('isNew'), 'must not be new');
      assert.false(person.get('hasDirtyAttributes'), 'must not be dirty');
      assert.true(person.get('isDeleted'), 'must be deleted');
      if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
        assert.strictEqual(person.get('rolledBackCount'), 1);
      }
    });

    test(`invalid new record's attributes can be rollbacked`, function (assert) {
      let error = new DS.InvalidError([
        {
          detail: 'is invalid',
          source: { pointer: 'data/attributes/name' },
        },
      ]);

      let adapter = DS.RESTAdapter.extend({
        ajax(url, type, hash) {
          return reject(error);
        },
      });

      this.owner.register('adapter:application', adapter);
      this.owner.register('serializer:application', RESTSerializer.extend());

      let store = this.owner.lookup('service:store');
      let person = store.createRecord('person', { id: 1 });

      assert.true(person.get('isNew'), 'must be new');
      assert.true(person.get('hasDirtyAttributes'), 'must be dirty');

      return run(() => {
        return person.save().catch((reason) => {
          assert.strictEqual(error, reason);
          assert.false(person.get('isValid'));

          run(() => person.rollbackAttributes());

          assert.false(person.get('isNew'), 'must not be new');
          assert.false(person.get('hasDirtyAttributes'), 'must not be dirty');
          assert.true(person.get('isDeleted'), 'must be deleted');
          if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
            assert.strictEqual(person.get('rolledBackCount'), 1);
          }
        });
      });
    });

    test(`invalid record's attributes can be rollbacked after multiple failed calls - #3677`, function (assert) {
      let adapter = DS.RESTAdapter.extend({
        ajax(url, type, hash) {
          let error = new DS.InvalidError();
          return reject(error);
        },
      });

      this.owner.register('adapter:application', adapter);
      this.owner.register('serializer:application', RESTSerializer.extend());

      let store = this.owner.lookup('service:store');

      let person;
      run(() => {
        person = store.push({
          data: {
            type: 'person',
            id: 1,
            attributes: {
              firstName: 'original name',
            },
          },
        });

        person.set('firstName', 'updated name');
      });

      return run(() => {
        assert.strictEqual(person.get('firstName'), 'updated name', 'precondition: firstName is changed');

        return person
          .save()
          .catch(() => {
            assert.true(person.get('hasDirtyAttributes'), 'has dirty attributes');
            assert.strictEqual(person.get('firstName'), 'updated name', 'firstName is still changed');

            return person.save();
          })
          .catch(() => {
            run(() => person.rollbackAttributes());

            assert.false(person.get('hasDirtyAttributes'), 'has no dirty attributes');
            assert.strictEqual(
              person.get('firstName'),
              'original name',
              'after rollbackAttributes() firstName has the original value'
            );
            if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
              assert.strictEqual(person.get('rolledBackCount'), 1);
            }
          });
      });
    });

    test(`deleted record's attributes can be rollbacked`, function (assert) {
      let store = this.owner.lookup('service:store');

      let person, people;

      run(() => {
        store.push({
          data: {
            type: 'person',
            id: '1',
          },
        });
        person = store.peekRecord('person', 1);
        people = store.peekAll('person');
        person.deleteRecord();
      });

      assert.strictEqual(people.get('length'), 1, 'a deleted record appears in the record array until it is saved');
      assert.strictEqual(people.objectAt(0), person, 'a deleted record appears in the record array until it is saved');

      assert.true(person.get('isDeleted'), 'must be deleted');

      run(() => person.rollbackAttributes());

      assert.strictEqual(people.get('length'), 1, 'the rollbacked record should appear again in the record array');
      assert.false(person.get('isDeleted'), 'must not be deleted');
      assert.false(person.get('hasDirtyAttributes'), 'must not be dirty');
    });

    test("invalid record's attributes can be rollbacked", async function (assert) {
      class Dog extends Model {
        @attr() name;
      }
      if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
        Dog.prototype.rolledBackCount = 0;
        Dog.prototype.rolledBack = function () {
          this.incrementProperty('rolledBackCount');
        };
      }
      const thrownAdapterError = new InvalidError([
        {
          detail: 'is invalid',
          source: { pointer: 'data/attributes/name' },
        },
      ]);
      class TestAdapter extends RESTAdapter {
        ajax() {
          return reject(thrownAdapterError);
        }
      }

      const { owner } = this;
      owner.register(`model:dog`, Dog);
      owner.register(`adapter:application`, TestAdapter);
      owner.register(`serializer:application`, RESTSerializer.extend());
      const store = owner.lookup(`service:store`);

      const dog = store.push({
        data: {
          type: 'dog',
          id: '1',
          attributes: {
            name: 'Pluto',
          },
        },
      });
      dog.set('name', 'is a dwarf planet');

      addObserver(dog, 'errors.name', function () {
        assert.ok(true, 'errors.name did change');
      });

      dog.get('errors').addArrayObserver(
        {},
        {
          willChange() {
            assert.ok(true, 'errors will change');
          },
          didChange() {
            assert.ok(true, 'errors did change');
          },
        }
      );

      try {
        assert.ok(true, 'saving');
        await dog.save();
      } catch (reason) {
        assert.strictEqual(reason, thrownAdapterError, 'We threw the expected error during save');

        dog.rollbackAttributes();
        await settled();

        assert.false(dog.get('hasDirtyAttributes'), 'must not be dirty');
        assert.strictEqual(dog.get('name'), 'Pluto', 'Name is rolled back');
        assert.notOk(dog.get('errors.name'), 'We have no errors for name anymore');
        assert.ok(dog.get('isValid'), 'We are now in a valid state');
        if (DEPRECATE_RECORD_LIFECYCLE_EVENT_METHODS) {
          assert.strictEqual(dog.get('rolledBackCount'), 1, 'we only rolled back once');
        }
      }

      assert.expectDeprecation({ id: 'array-observers', count: 1, when: { ember: '>=3.26.0' } });
    });
  });

  test(`invalid record's attributes rolled back to correct state after set`, async function (assert) {
    class Dog extends Model {
      @attr() name;
      @attr() breed;
    }
    const thrownAdapterError = new InvalidError([
      {
        detail: 'is invalid',
        source: { pointer: 'data/attributes/name' },
      },
    ]);
    class TestAdapter extends RESTAdapter {
      ajax() {
        return reject(thrownAdapterError);
      }
    }
    const { owner } = this;
    owner.register(`model:dog`, Dog);
    owner.register(`adapter:application`, TestAdapter);
    owner.register(`serializer:application`, RESTSerializer.extend());
    const store = owner.lookup(`service:store`);

    const dog = store.push({
      data: {
        type: 'dog',
        id: '1',
        attributes: {
          name: 'Pluto',
          breed: 'Disney',
        },
      },
    });

    dog.set('name', 'is a dwarf planet');
    dog.set('breed', 'planet');

    addObserver(dog, 'errors.name', function () {
      assert.ok(true, 'errors.name did change');
    });

    try {
      await dog.save();
    } catch (reason) {
      assert.strictEqual(reason, thrownAdapterError);
      assert.strictEqual(dog.get('name'), 'is a dwarf planet');
      assert.strictEqual(dog.get('breed'), 'planet');
      assert.ok(isPresent(dog.get('errors.name')));
      assert.strictEqual(dog.get('errors.name.length'), 1);

      dog.set('name', 'Seymour Asses');
      await settled();

      assert.strictEqual(dog.get('name'), 'Seymour Asses');
      assert.strictEqual(dog.get('breed'), 'planet');

      dog.rollbackAttributes();
      await settled();

      assert.strictEqual(dog.get('name'), 'Pluto');
      assert.strictEqual(dog.get('breed'), 'Disney');
      assert.false(dog.get('hasDirtyAttributes'), 'must not be dirty');
      assert.notOk(dog.get('errors.name'));
      assert.ok(dog.get('isValid'));
    }
  });

  test(`when destroying a record setup the record state to invalid, the record's attributes can be rollbacked`, function (assert) {
    const Dog = DS.Model.extend({
      name: DS.attr(),
    });

    let error = new DS.InvalidError([
      {
        detail: 'is invalid',
        source: { pointer: 'data/attributes/name' },
      },
    ]);

    let adapter = DS.RESTAdapter.extend({
      ajax(url, type, hash) {
        return reject(error);
      },
    });

    this.owner.register('model:dog', Dog);
    this.owner.register('adapter:application', adapter);
    this.owner.register('serializer:application', RESTSerializer.extend());

    let store = this.owner.lookup('service:store');

    let dog = run(() => {
      store.push({
        data: {
          type: 'dog',
          id: '1',
          attributes: {
            name: 'Pluto',
          },
        },
      });
      return store.peekRecord('dog', 1);
    });

    return run(() => {
      return dog.destroyRecord().catch((reason) => {
        assert.strictEqual(reason, error);

        assert.false(dog.get('isError'), 'must not be error');
        assert.true(dog.get('isDeleted'), 'must be deleted');
        assert.false(dog.get('isValid'), 'must not be valid');
        assert.ok(dog.get('errors.length') > 0, 'must have errors');

        dog.rollbackAttributes();

        assert.false(dog.get('isError'), 'must not be error after `rollbackAttributes`');
        assert.false(dog.get('isDeleted'), 'must not be deleted after `rollbackAttributes`');
        assert.true(dog.get('isValid'), 'must be valid after `rollbackAttributes`');
        assert.ok(dog.get('errors.length') === 0, 'must not have errors');
      });
    });
  });
});
