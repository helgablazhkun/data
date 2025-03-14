/*eslint no-unused-vars: ["error", { "args": "none", "varsIgnorePattern": "(page)" }]*/

import { get } from '@ember/object';
import { run } from '@ember/runloop';

import { module, test } from 'qunit';
import { all, hash, Promise as EmberPromise, reject, resolve } from 'rsvp';

import { setupTest } from 'ember-qunit';

import Adapter from '@ember-data/adapter';
import JSONAPIAdapter from '@ember-data/adapter/json-api';
import RESTAdapter from '@ember-data/adapter/rest';
import Model, { attr, belongsTo, hasMany } from '@ember-data/model';
import JSONAPISerializer from '@ember-data/serializer/json-api';
import RESTSerializer from '@ember-data/serializer/rest';
import { deprecatedTest } from '@ember-data/unpublished-test-infra/test-support/deprecated-test';
import testInDebug from '@ember-data/unpublished-test-infra/test-support/test-in-debug';

import { getRelationshipStateForRecord, hasRelationshipForRecord } from '../../helpers/accessors';

module('integration/relationships/has_many - Has-Many Relationships', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    const User = Model.extend({
      name: attr('string'),
      messages: hasMany('message', { polymorphic: true, async: false }),
      contacts: hasMany('user', { inverse: null, async: false }),
    });

    const Contact = Model.extend({
      user: belongsTo('user', { async: false }),
      toString: () => 'Contact',
    });

    const Email = Contact.extend({
      email: attr('string'),
      toString: () => 'Email',
    });

    const Phone = Contact.extend({
      number: attr('string'),
      toString: () => 'Phone',
    });

    const Message = Model.extend({
      user: belongsTo('user', { async: false }),
      created_at: attr('date'),
      toString: () => 'Message',
    });

    const Post = Message.extend({
      title: attr('string'),
      comments: hasMany('comment', { async: false }),
      toString: () => 'Post',
    });

    const Comment = Message.extend({
      body: attr('string'),
      message: belongsTo('post', { polymorphic: true, async: true }),
      toString: () => 'Comment',
    });

    const Book = Model.extend({
      title: attr(),
      chapters: hasMany('chapter', { async: true }),
      toString: () => 'Book',
    });

    const Chapter = Model.extend({
      title: attr(),
      pages: hasMany('page', { async: false }),
      toString: () => 'Chapter',
    });

    const Page = Model.extend({
      number: attr('number'),
      chapter: belongsTo('chapter', { async: false }),
      toString: () => 'Page',
    });

    this.owner.register('model:user', User);
    this.owner.register('model:contact', Contact);
    this.owner.register('model:email', Email);
    this.owner.register('model:phone', Phone);
    this.owner.register('model:post', Post);
    this.owner.register('model:comment', Comment);
    this.owner.register('model:message', Message);
    this.owner.register('model:book', Book);
    this.owner.register('model:chapter', Chapter);
    this.owner.register('model:page', Page);

    this.owner.register('adapter:application', Adapter.extend());
    this.owner.register('serializer:application', JSONAPISerializer.extend());
  });

  testInDebug(
    'hasMany relationships fetched by link should error if no data member is present in the returned payload',
    async function (assert) {
      class Company extends Model {
        @hasMany('employee', { inverse: null, async: true })
        employees;
        @attr name;
      }
      class Employee extends Model {
        @attr name;
      }
      this.owner.register('model:employee', Employee);
      this.owner.register('model:company', Company);
      this.owner.register(
        'adapter:company',
        JSONAPIAdapter.extend({
          findHasMany(store, type, snapshot) {
            return resolve({
              links: {
                related: 'company/1/employees',
              },
              meta: {},
            });
          },
        })
      );

      const store = this.owner.lookup('service:store');
      const company = store.push({
        data: {
          type: 'company',
          id: '1',
          attributes: {
            name: 'Github',
          },
          relationships: {
            employees: {
              links: {
                related: 'company/1/employees',
              },
            },
          },
        },
      });

      try {
        await company.employees;
        assert.ok(false, 'We should have thrown an error');
      } catch (e) {
        assert.strictEqual(
          e.message,
          `Assertion Failed: fetched the hasMany relationship 'employees' for company:1 with link 'company/1/employees', but no data member is present in the response. If no data exists, the response should set { data: [] }`,
          'We error appropriately'
        );
      }
    }
  );

  testInDebug('Invalid hasMany relationship identifiers throw errors', function (assert) {
    assert.expect(2);

    let store = this.owner.lookup('service:store');

    // test null id
    assert.expectAssertion(() => {
      run(() => {
        let post = store.push({
          data: {
            id: '1',
            type: 'post',
            relationships: {
              comments: {
                data: [{ id: null, type: 'comment' }],
              },
            },
          },
        });

        post.get('comments');
      });
    }, `Assertion Failed: Encountered a relationship identifier without an id for the hasMany relationship 'comments' on <post:1>, expected a json-api identifier but found '{"id":null,"type":"comment"}'. Please check your serializer and make sure it is serializing the relationship payload into a JSON API format.`);

    // test missing type
    assert.expectAssertion(() => {
      run(() => {
        let post = store.push({
          data: {
            id: '2',
            type: 'post',
            relationships: {
              comments: {
                data: [{ id: '1', type: null }],
              },
            },
          },
        });
        post.get('comments');
      });
    }, `Assertion Failed: Encountered a relationship identifier without a type for the hasMany relationship 'comments' on <post:2>, expected a json-api identifier with type 'comment' but found '{"id":"1","type":null}'. Please check your serializer and make sure it is serializing the relationship payload into a JSON API format.`);
  });

  test("When a hasMany relationship is accessed, the adapter's findMany method should not be called if all the records in the relationship are already loaded", function (assert) {
    assert.expect(0);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    let postData = {
      type: 'post',
      id: '1',
      relationships: {
        comments: {
          data: [{ type: 'comment', id: '1' }],
        },
      },
    };

    adapter.findMany = function (store, type, ids, snapshots) {
      assert.ok(false, "The adapter's find method should not be called");
    };

    adapter.findRecord = function (store, type, ids, snapshots) {
      return { data: postData };
    };

    return run(() => {
      store.push({
        data: postData,
        included: [
          {
            type: 'comment',
            id: '1',
          },
        ],
      });

      return store.findRecord('post', 1).then((post) => {
        return post.get('comments');
      });
    });
  });

  test('hasMany + canonical vs currentState + destroyRecord  ', async function (assert) {
    assert.expect(7);

    let store = this.owner.lookup('service:store');

    let postData = {
      type: 'user',
      id: '1',
      attributes: {
        name: 'omg',
      },
      relationships: {
        contacts: {
          data: [
            {
              type: 'user',
              id: '2',
            },
            {
              type: 'user',
              id: '3',
            },
            {
              type: 'user',
              id: '4',
            },
          ],
        },
      },
    };

    run(() => {
      store.push({
        data: postData,
        included: [
          {
            type: 'user',
            id: '2',
          },
          {
            type: 'user',
            id: '3',
          },
          {
            type: 'user',
            id: '4',
          },
        ],
      });
    });

    let user = store.peekRecord('user', 1);
    let contacts = user.get('contacts');

    store.adapterFor('user').deleteRecord = function () {
      return { data: { type: 'user', id: 2 } };
    };

    assert.deepEqual(
      contacts.map((c) => c.get('id')),
      ['2', '3', '4'],
      'user should have expected contacts'
    );

    run(() => {
      contacts.addObject(store.createRecord('user', { id: 5 }));
      contacts.addObject(store.createRecord('user', { id: 6 }));
      contacts.addObject(store.createRecord('user', { id: 7 }));
    });

    assert.deepEqual(
      contacts.map((c) => c.get('id')),
      ['2', '3', '4', '5', '6', '7'],
      'user should have expected contacts'
    );

    await store.peekRecord('user', 2).destroyRecord();
    await store.peekRecord('user', 6).destroyRecord();

    assert.deepEqual(
      contacts.map((c) => c.get('id')),
      ['3', '4', '5', '7'],
      `user's contacts should have expected contacts`
    );
    assert.strictEqual(contacts, user.get('contacts'));

    assert.ok(!user.contacts.initialState || !user.contacts.initialState.find((model) => model.id === '2'));

    run(() => {
      contacts.addObject(store.createRecord('user', { id: 8 }));
    });

    assert.deepEqual(
      contacts.map((c) => c.get('id')),
      ['3', '4', '5', '7', '8'],
      `user's contacts should have expected contacts`
    );
    assert.strictEqual(contacts, user.get('contacts'));
  });

  test('hasMany + canonical vs currentState + unloadRecord', function (assert) {
    assert.expect(6);

    let store = this.owner.lookup('service:store');

    let postData = {
      type: 'user',
      id: '1',
      attributes: {
        name: 'omg',
      },
      relationships: {
        contacts: {
          data: [
            {
              type: 'user',
              id: 2,
            },
            {
              type: 'user',
              id: 3,
            },
            {
              type: 'user',
              id: 4,
            },
          ],
        },
      },
    };

    run(() => {
      store.push({
        data: postData,
        included: [
          {
            type: 'user',
            id: 2,
          },
          {
            type: 'user',
            id: 3,
          },
          {
            type: 'user',
            id: 4,
          },
        ],
      });
    });

    let user = store.peekRecord('user', 1);
    let contacts = user.get('contacts');

    store.adapterFor('user').deleteRecord = function () {
      return { data: { type: 'user', id: 2 } };
    };

    assert.deepEqual(
      contacts.map((c) => c.get('id')),
      ['2', '3', '4'],
      'user should have expected contacts'
    );

    run(() => {
      contacts.addObject(store.createRecord('user', { id: 5 }));
      contacts.addObject(store.createRecord('user', { id: 6 }));
      contacts.addObject(store.createRecord('user', { id: 7 }));
    });

    assert.deepEqual(
      contacts.map((c) => c.get('id')),
      ['2', '3', '4', '5', '6', '7'],
      'user should have expected contacts'
    );

    run(() => {
      store.peekRecord('user', 2).unloadRecord();
      store.peekRecord('user', 6).unloadRecord();
    });

    assert.deepEqual(
      contacts.map((c) => c.get('id')),
      ['3', '4', '5', '7'],
      `user's contacts should have expected contacts`
    );
    assert.strictEqual(contacts, user.get('contacts'));

    run(() => {
      contacts.addObject(store.createRecord('user', { id: 8 }));
    });

    assert.deepEqual(
      contacts.map((c) => c.get('id')),
      ['3', '4', '5', '7', '8'],
      `user's contacts should have expected contacts`
    );
    assert.strictEqual(contacts, user.get('contacts'));
  });

  test('adapter.findMany only gets unique IDs even if duplicate IDs are present in the hasMany relationship', function (assert) {
    assert.expect(2);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');
    let Chapter = store.modelFor('chapter');

    let bookData = {
      type: 'book',
      id: '1',
      relationships: {
        chapters: {
          data: [
            { type: 'chapter', id: '2' },
            { type: 'chapter', id: '3' },
            { type: 'chapter', id: '3' },
          ],
        },
      },
    };

    adapter.findMany = function (store, type, ids, snapshots) {
      assert.strictEqual(type, Chapter, 'type passed to adapter.findMany is correct');
      assert.deepEqual(ids, ['2', '3'], 'ids passed to adapter.findMany are unique');

      return resolve({
        data: [
          { id: 2, type: 'chapter', attributes: { title: 'Chapter One' } },
          { id: 3, type: 'chapter', attributes: { title: 'Chapter Two' } },
        ],
      });
    };

    adapter.findRecord = function (store, type, ids, snapshots) {
      return { data: bookData };
    };

    return run(() => {
      store.push({
        data: bookData,
      });

      return store.findRecord('book', 1).then((book) => {
        return book.get('chapters');
      });
    });
  });

  // This tests the case where a serializer materializes a has-many
  // relationship as a internalModel that it can fetch lazily. The most
  // common use case of this is to provide a URL to a collection that
  // is loaded later.
  test("A serializer can materialize a hasMany as an opaque token that can be lazily fetched via the adapter's findHasMany hook", function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    const Post = store.modelFor('post');

    Post.reopen({
      comments: hasMany('comment', { async: true }),
    });

    // When the store asks the adapter for the record with ID 1,
    // provide some fake data.
    adapter.findRecord = function (store, type, id, snapshot) {
      assert.strictEqual(type, Post, 'find type was Post');
      assert.strictEqual(id, '1', 'find id was 1');

      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              links: {
                related: '/posts/1/comments',
              },
            },
          },
        },
      });
    };
    //({ id: 1, links: { comments: "/posts/1/comments" } });

    adapter.findMany = function (store, type, ids, snapshots) {
      throw new Error("Adapter's findMany should not be called");
    };

    adapter.findHasMany = function (store, snapshot, link, relationship) {
      assert.strictEqual(link, '/posts/1/comments', 'findHasMany link was /posts/1/comments');
      assert.strictEqual(relationship.type, 'comment', 'relationship was passed correctly');

      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'First' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };

    return run(() => {
      return store
        .findRecord('post', 1)
        .then((post) => {
          return post.get('comments');
        })
        .then((comments) => {
          assert.true(comments.get('isLoaded'), 'comments are loaded');
          assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');
          assert.strictEqual(comments.objectAt(0).get('body'), 'First', 'comment loaded successfully');
        });
    });
  });

  test('Accessing a hasMany backed by a link multiple times triggers only one request', function (assert) {
    assert.expect(2);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    store.modelFor('comment').reopen({
      message: belongsTo('post', { async: true }),
    });

    let post;

    run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: '/posts/1/comments',
              },
            },
          },
        },
      });
      post = store.peekRecord('post', 1);
    });

    let count = 0;
    adapter.findHasMany = function (store, snapshot, link, relationship) {
      count++;
      assert.strictEqual(count, 1, 'findHasMany has only been called once');
      return new EmberPromise((resolve, reject) => {
        setTimeout(() => {
          let value = {
            data: [
              { id: 1, type: 'comment', attributes: { body: 'First' } },
              { id: 2, type: 'comment', attributes: { body: 'Second' } },
            ],
          };
          resolve(value);
        }, 100);
      });
    };

    let promise1, promise2;

    run(() => {
      promise1 = post.get('comments');
      //Invalidate the post.comments CP
      store.push({
        data: {
          type: 'comment',
          id: '1',
          relationships: {
            message: {
              data: { type: 'post', id: '1' },
            },
          },
        },
      });
      promise2 = post.get('comments');
    });

    return all([promise1, promise2]).then(() => {
      assert.strictEqual(promise1.get('promise'), promise2.get('promise'), 'Same promise is returned both times');
    });
  });

  test('A hasMany backed by a link remains a promise after a record has been added to it', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    store.modelFor('comment').reopen({
      message: belongsTo('post', { async: true }),
    });

    adapter.findHasMany = function (store, snapshot, link, relationship) {
      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'First' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };

    let post;
    run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: '/posts/1/comments',
              },
            },
          },
        },
      });
      post = store.peekRecord('post', 1);
    });

    return run(() => {
      return post.get('comments').then(() => {
        store.push({
          data: {
            type: 'comment',
            id: '3',
            relationships: {
              message: {
                data: { type: 'post', id: '1' },
              },
            },
          },
        });

        return post.get('comments').then(() => {
          assert.ok(true, 'Promise was called');
        });
      });
    });
  });

  test('A hasMany updated link should not remove new children', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    store.modelFor('comment').reopen({
      message: belongsTo('post', { async: true }),
    });

    adapter.findHasMany = function (store, snapshot, link, relationship) {
      return resolve({ data: [] });
    };

    adapter.createRecord = function (store, snapshot, link, relationship) {
      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              links: { related: '/some/link' },
            },
          },
        },
      });
    };

    return run(() => {
      let post = store.createRecord('post', {});
      store.createRecord('comment', { message: post });

      return post
        .get('comments')
        .then((comments) => {
          assert.strictEqual(comments.get('length'), 1, 'initially we have one comment');

          return post.save();
        })
        .then(() => post.get('comments'))
        .then((comments) => {
          assert.strictEqual(comments.get('length'), 1, 'after saving, we still have one comment');
        });
    });
  });

  test('A hasMany updated link should not remove new children when the parent record has children already', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    store.modelFor('comment').reopen({
      message: belongsTo('post', { async: true }),
    });

    adapter.findHasMany = function (store, snapshot, link, relationship) {
      return resolve({
        data: [{ id: 5, type: 'comment', attributes: { body: 'hello' } }],
      });
    };

    adapter.createRecord = function (store, snapshot, link, relationship) {
      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              links: { related: '/some/link' },
            },
          },
        },
      });
    };

    return run(() => {
      let post = store.createRecord('post', {});
      store.createRecord('comment', { message: post });

      return post
        .get('comments')
        .then((comments) => {
          assert.strictEqual(comments.get('length'), 1);
          return post.save();
        })
        .then(() => post.get('comments'))
        .then((comments) => {
          assert.strictEqual(comments.get('length'), 2);
        });
    });
  });

  test("A hasMany relationship doesn't contain duplicate children, after the canonical state of the relationship is updated via store#push", function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    store.modelFor('comment').reopen({
      message: belongsTo('post', { async: true }),
    });

    adapter.createRecord = function (store, snapshot, link, relationship) {
      return resolve({ data: { id: 1, type: 'post' } });
    };

    return run(() => {
      let post = store.createRecord('post', {});

      // create a new comment with id 'local', which is in the 'comments'
      // relationship of post
      let localComment = store.createRecord('comment', { id: 'local', message: post });

      return post
        .get('comments')
        .then((comments) => {
          assert.strictEqual(comments.get('length'), 1);
          assert.true(localComment.get('isNew'));

          return post.save();
        })
        .then(() => {
          // Now the post is saved but the locally created comment with the id
          // 'local' is still in the created state since it hasn't been saved
          // yet.
          //
          // As next we are pushing the post into the store again, having the
          // locally created comment in the 'comments' relationship. By this the
          // canonical state of the relationship is defined to consist of one
          // comment: the one with id 'local'.
          //
          // This setup is needed to demonstrate the bug which has been fixed
          // in #4154, where the locally created comment was duplicated in the
          // comment relationship.
          store.push({
            data: {
              type: 'post',
              id: 1,
              relationships: {
                comments: {
                  data: [{ id: 'local', type: 'comment' }],
                },
              },
            },
          });
        })
        .then(() => post.get('comments'))
        .then((comments) => {
          assert.strictEqual(comments.get('length'), 1);
          assert.true(localComment.get('isNew'));
        });
    });
  });

  test('A hasMany relationship can be reloaded if it was fetched via a link', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    const Post = store.modelFor('post');

    Post.reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findRecord = function (store, type, id, snapshot) {
      assert.strictEqual(type, Post, 'find type was Post');
      assert.strictEqual(id, '1', 'find id was 1');

      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              links: { related: '/posts/1/comments' },
            },
          },
        },
      });
    };

    adapter.findHasMany = function (store, snapshot, link, relationship) {
      assert.strictEqual(relationship.type, 'comment', 'findHasMany relationship type was Comment');
      assert.strictEqual(relationship.key, 'comments', 'findHasMany relationship key was comments');
      assert.strictEqual(link, '/posts/1/comments', 'findHasMany link was /posts/1/comments');

      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'First' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };

    run(function () {
      run(store, 'findRecord', 'post', 1)
        .then(function (post) {
          return post.get('comments');
        })
        .then(function (comments) {
          assert.true(comments.get('isLoaded'), 'comments are loaded');
          assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');

          adapter.findHasMany = function (store, snapshot, link, relationship) {
            assert.strictEqual(relationship.type, 'comment', 'findHasMany relationship type was Comment');
            assert.strictEqual(relationship.key, 'comments', 'findHasMany relationship key was comments');
            assert.strictEqual(link, '/posts/1/comments', 'findHasMany link was /posts/1/comments');

            return resolve({
              data: [
                { id: 1, type: 'comment', attributes: { body: 'First' } },
                { id: 2, type: 'comment', attributes: { body: 'Second' } },
                { id: 3, type: 'comment', attributes: { body: 'Thirds' } },
              ],
            });
          };

          return comments.reload();
        })
        .then(function (newComments) {
          assert.strictEqual(newComments.get('length'), 3, 'reloaded comments have 3 length');
        });
    });
  });

  test('A sync hasMany relationship can be reloaded if it was fetched via ids', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    const Post = store.modelFor('post');

    Post.reopen({
      comments: hasMany('comment', { async: false }),
    });

    adapter.findRecord = function (store, type, id, snapshot) {
      assert.strictEqual(type, Post, 'find type was Post');
      assert.strictEqual(id, '1', 'find id was 1');

      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              data: [
                { id: 1, type: 'comment' },
                { id: 2, type: 'comment' },
              ],
            },
          },
        },
      });
    };

    run(function () {
      store.push({
        data: [
          {
            type: 'comment',
            id: '1',
            attributes: {
              body: 'First',
            },
          },
          {
            type: 'comment',
            id: '2',
            attributes: {
              body: 'Second',
            },
          },
        ],
      });

      store
        .findRecord('post', '1')
        .then(function (post) {
          let comments = post.get('comments');
          assert.true(comments.get('isLoaded'), 'comments are loaded');
          assert.strictEqual(comments.get('length'), 2, 'comments have a length of 2');

          adapter.findMany = function (store, type, ids, snapshots) {
            return resolve({
              data: [
                { id: 1, type: 'comment', attributes: { body: 'FirstUpdated' } },
                { id: 2, type: 'comment', attributes: { body: 'Second' } },
              ],
            });
          };

          return comments.reload();
        })
        .then(function (newComments) {
          assert.strictEqual(newComments.get('firstObject.body'), 'FirstUpdated', 'Record body was correctly updated');
        });
    });
  });

  test('A hasMany relationship can be reloaded if it was fetched via ids', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    const Post = store.modelFor('post');

    Post.reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findRecord = function (store, type, id, snapshot) {
      assert.strictEqual(type, Post, 'find type was Post');
      assert.strictEqual(id, '1', 'find id was 1');

      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              data: [
                { id: 1, type: 'comment' },
                { id: 2, type: 'comment' },
              ],
            },
          },
        },
      });
    };

    adapter.findMany = function (store, type, ids, snapshots) {
      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'First' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };

    run(function () {
      store
        .findRecord('post', 1)
        .then(function (post) {
          return post.get('comments');
        })
        .then(function (comments) {
          assert.true(comments.get('isLoaded'), 'comments are loaded');
          assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');

          adapter.findMany = function (store, type, ids, snapshots) {
            return resolve({
              data: [
                { id: 1, type: 'comment', attributes: { body: 'FirstUpdated' } },
                { id: 2, type: 'comment', attributes: { body: 'Second' } },
              ],
            });
          };

          return comments.reload();
        })
        .then(function (newComments) {
          assert.strictEqual(newComments.get('firstObject.body'), 'FirstUpdated', 'Record body was correctly updated');
        });
    });
  });

  test('A hasMany relationship can be reloaded even if it failed at the first time', async function (assert) {
    assert.expect(7);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findRecord = function () {
      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              links: { related: '/posts/1/comments' },
            },
          },
        },
      });
    };

    let loadingCount = 0;
    adapter.findHasMany = function () {
      loadingCount++;
      if (loadingCount % 2 === 1) {
        return reject({ data: null });
      } else {
        return resolve({
          data: [
            { id: 1, type: 'comment', attributes: { body: 'FirstUpdated' } },
            { id: 2, type: 'comment', attributes: { body: 'Second' } },
          ],
        });
      }
    };

    let post = await store.findRecord('post', 1);
    let comments = post.get('comments');
    let manyArray;

    try {
      manyArray = await comments;
      assert.ok(false, 'Expected exception to be raised');
    } catch (e) {
      assert.ok(true, `An error was thrown on the first reload of comments: ${e.message}`);
      manyArray = await comments.reload();
    }

    assert.true(manyArray.get('isLoaded'), 'the reload worked, comments are now loaded');

    try {
      await manyArray.reload();
      assert.ok(false, 'Expected exception to be raised');
    } catch (e) {
      assert.ok(true, `An error was thrown on the second reload via manyArray: ${e.message}`);
    }

    assert.true(manyArray.get('isLoaded'), 'the second reload failed, comments are still loaded though');

    let reloadedManyArray = await manyArray.reload();

    assert.true(reloadedManyArray.get('isLoaded'), 'the third reload worked, comments are loaded again');
    assert.ok(reloadedManyArray === manyArray, 'the many array stays the same');
    assert.strictEqual(loadingCount, 4, 'We only fired 4 requests');
  });

  test('A hasMany relationship can be directly reloaded if it was fetched via links', function (assert) {
    assert.expect(6);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');
    let Post = store.modelFor('post');

    Post.reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findRecord = function (store, type, id) {
      assert.strictEqual(type, Post, 'find type was Post');
      assert.strictEqual(id, '1', 'find id was 1');

      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              links: { related: '/posts/1/comments' },
            },
          },
        },
      });
    };

    adapter.findHasMany = function (store, record, link, relationship) {
      assert.strictEqual(link, '/posts/1/comments', 'findHasMany link was /posts/1/comments');

      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'FirstUpdated' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };
    run(function () {
      store.findRecord('post', 1).then(function (post) {
        return post
          .get('comments')
          .reload()
          .then(function (comments) {
            assert.true(comments.get('isLoaded'), 'comments are loaded');
            assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');
            assert.strictEqual(comments.get('firstObject.body'), 'FirstUpdated', 'Record body was correctly updated');
          });
      });
    });
  });

  test('Has many via links - Calling reload multiple times does not send a new request if the first one is not settled', function (assert) {
    assert.expect(1);

    let done = assert.async();

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findRecord = function (store, type, id) {
      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              links: { related: '/posts/1/comments' },
            },
          },
        },
      });
    };

    let count = 0;
    adapter.findHasMany = function (store, record, link, relationship) {
      count++;
      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'First' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };
    run(function () {
      store.findRecord('post', 1).then(function (post) {
        post.get('comments').then(function (comments) {
          all([comments.reload(), comments.reload(), comments.reload()]).then(function (comments) {
            assert.strictEqual(
              count,
              2,
              'One request for the original access and only one request for the mulitple reloads'
            );
            done();
          });
        });
      });
    });
  });

  test('A hasMany relationship can be directly reloaded if it was fetched via ids', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');
    let Post = store.modelFor('post');

    Post.reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findRecord = function (store, type, id, snapshot) {
      assert.strictEqual(type, Post, 'find type was Post');
      assert.strictEqual(id, '1', 'find id was 1');

      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              data: [
                { id: 1, type: 'comment' },
                { id: 2, type: 'comment' },
              ],
            },
          },
        },
      });
    };

    adapter.findMany = function (store, type, ids, snapshots) {
      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'FirstUpdated' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };

    run(function () {
      store.findRecord('post', 1).then(function (post) {
        return post
          .get('comments')
          .reload()
          .then(function (comments) {
            assert.true(comments.get('isLoaded'), 'comments are loaded');
            assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');
            assert.strictEqual(comments.get('firstObject.body'), 'FirstUpdated', 'Record body was correctly updated');
          });
      });
    });
  });

  test('Has many via ids - Calling reload multiple times does not send a new request if the first one is not settled', function (assert) {
    assert.expect(1);

    let done = assert.async();

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findRecord = function (store, type, id, snapshot) {
      return resolve({
        data: {
          id: 1,
          type: 'post',
          relationships: {
            comments: {
              data: [
                { id: 1, type: 'comment' },
                { id: 2, type: 'comment' },
              ],
            },
          },
        },
      });
    };

    let count = 0;
    adapter.findMany = function (store, type, ids, snapshots) {
      count++;
      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'FirstUpdated' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };

    run(function () {
      store.findRecord('post', 1).then(function (post) {
        post.get('comments').then(function (comments) {
          all([comments.reload(), comments.reload(), comments.reload()]).then(function (comments) {
            assert.strictEqual(
              count,
              2,
              'One request for the original access and only one request for the mulitple reloads'
            );
            done();
          });
        });
      });
    });
  });

  test('PromiseArray proxies createRecord to its ManyArray once the hasMany is loaded', function (assert) {
    assert.expect(4);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findHasMany = function (store, snapshot, link, relationship) {
      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'First' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };
    let post;

    run(function () {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: 'someLink',
              },
            },
          },
        },
      });
      post = store.peekRecord('post', 1);
    });

    run(function () {
      post.get('comments').then(function (comments) {
        assert.true(comments.get('isLoaded'), 'comments are loaded');
        assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');

        let newComment = post.get('comments').createRecord({ body: 'Third' });
        assert.strictEqual(newComment.get('body'), 'Third', 'new comment is returned');
        assert.strictEqual(comments.get('length'), 3, 'comments have 3 length, including new record');
      });
    });
  });

  deprecatedTest(
    'PromiseArray proxies evented methods to its ManyArray',
    {
      id: 'ember-data:evented-api-usage',
      count: 3,
      until: '4.0',
    },
    function (assert) {
      assert.expect(6);

      let store = this.owner.lookup('service:store');
      let adapter = store.adapterFor('application');

      store.modelFor('post').reopen({
        comments: hasMany('comment', { async: true }),
      });

      adapter.findHasMany = function (store, snapshot, link, relationship) {
        return resolve({
          data: [
            { id: 1, type: 'comment', attributes: { body: 'First' } },
            { id: 2, type: 'comment', attributes: { body: 'Second' } },
          ],
        });
      };
      let post, comments;

      run(function () {
        store.push({
          data: {
            type: 'post',
            id: '1',
            relationships: {
              comments: {
                links: {
                  related: 'someLink',
                },
              },
            },
          },
        });
        post = store.peekRecord('post', 1);
        comments = post.get('comments');
      });

      comments.on('on-event', function () {
        assert.ok(true);
      });

      run(function () {
        comments.trigger('on-event');
      });

      assert.strictEqual(comments.has('on-event'), true);
      const cb = function () {
        assert.ok(false, 'We should not trigger this event');
      };

      comments.on('off-event', cb);
      comments.off('off-event', cb);

      assert.strictEqual(comments.has('off-event'), false);

      comments.one('one-event', function () {
        assert.ok(true);
      });

      assert.strictEqual(comments.has('one-event'), true);

      run(function () {
        comments.trigger('one-event');
      });

      assert.strictEqual(comments.has('one-event'), false);
    }
  );

  test('An updated `links` value should invalidate a relationship cache', async function (assert) {
    assert.expect(8);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findHasMany = function (store, snapshot, link, relationship) {
      assert.strictEqual(relationship.type, 'comment', 'relationship was passed correctly');

      if (link === '/first') {
        return resolve({
          data: [
            { id: 1, type: 'comment', attributes: { body: 'First' } },
            { id: 2, type: 'comment', attributes: { body: 'Second' } },
          ],
        });
      } else if (link === '/second') {
        return resolve({
          data: [
            { id: 3, type: 'comment', attributes: { body: 'Third' } },
            { id: 4, type: 'comment', attributes: { body: 'Fourth' } },
            { id: 5, type: 'comment', attributes: { body: 'Fifth' } },
          ],
        });
      }
    };
    let post;

    run(function () {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: '/first',
              },
            },
          },
        },
      });
      post = store.peekRecord('post', 1);
    });

    const comments = await post.get('comments');
    assert.true(comments.get('isLoaded'), 'comments are loaded');
    assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');
    assert.strictEqual(comments.objectAt(0).get('body'), 'First', 'comment 1 successfully loaded');
    store.push({
      data: {
        type: 'post',
        id: '1',
        relationships: {
          comments: {
            links: {
              related: '/second',
            },
          },
        },
      },
    });
    const newComments = await post.get('comments');
    assert.true(comments === newComments, 'hasMany array was kept the same');
    assert.strictEqual(newComments.get('length'), 3, 'comments updated successfully');
    assert.strictEqual(newComments.objectAt(0).get('body'), 'Third', 'third comment loaded successfully');
  });

  test("When a polymorphic hasMany relationship is accessed, the adapter's findMany method should not be called if all the records in the relationship are already loaded", function (assert) {
    assert.expect(1);

    let userData = {
      type: 'user',
      id: '1',
      relationships: {
        messages: {
          data: [
            { type: 'post', id: '1' },
            { type: 'comment', id: '3' },
          ],
        },
      },
    };

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.findMany = function (store, type, ids, snapshots) {
      assert.ok(false, "The adapter's find method should not be called");
    };

    adapter.findRecord = function (store, type, ids, snapshots) {
      return { data: userData };
    };

    run(function () {
      store.push({
        data: userData,
        included: [
          {
            type: 'post',
            id: '1',
          },
          {
            type: 'comment',
            id: '3',
          },
        ],
      });
    });

    run(function () {
      store.findRecord('user', 1).then(function (user) {
        let messages = user.get('messages');
        assert.strictEqual(messages.get('length'), 2, 'The messages are correctly loaded');
      });
    });
  });

  test("When a polymorphic hasMany relationship is accessed, the store can call multiple adapters' findMany or find methods if the records are not loaded", function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('user').reopen({
      messages: hasMany('message', { polymorphic: true, async: true }),
    });

    adapter.shouldBackgroundReloadRecord = () => false;
    adapter.findRecord = function (store, type, id, snapshot) {
      if (type === store.modelFor('post')) {
        return resolve({ data: { id: 1, type: 'post' } });
      } else if (type === store.modelFor('comment')) {
        return resolve({ data: { id: 3, type: 'comment' } });
      }
    };

    run(function () {
      store.push({
        data: {
          type: 'user',
          id: '1',
          relationships: {
            messages: {
              data: [
                { type: 'post', id: '1' },
                { type: 'comment', id: '3' },
              ],
            },
          },
        },
      });
    });

    run(function () {
      store
        .findRecord('user', 1)
        .then(function (user) {
          return user.get('messages');
        })
        .then(function (messages) {
          assert.strictEqual(messages.get('length'), 2, 'The messages are correctly loaded');
        });
    });
  });

  test('polymorphic hasMany type-checks check the superclass', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');

    run(function () {
      let igor = store.createRecord('user', { name: 'Igor' });
      let comment = store.createRecord('comment', {
        body: 'Well I thought the title was fine',
      });

      igor.get('messages').addObject(comment);

      assert.strictEqual(igor.get('messages.firstObject.body'), 'Well I thought the title was fine');
    });
  });

  test('Type can be inferred from the key of a hasMany relationship', async function (assert) {
    assert.expect(1);

    const User = Model.extend({
      name: attr(),
      contacts: hasMany({ inverse: null, async: false }),
    });

    const Contact = Model.extend({
      name: attr(),
      user: belongsTo('user', { async: false }),
    });

    this.owner.register('model:user', User);
    this.owner.register('model:contact', Contact);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.findRecord = function () {
      return {
        data: {
          id: '1',
          type: 'user',
          relationships: {
            contacts: {
              data: [{ id: '1', type: 'contact' }],
            },
          },
        },
      };
    };

    const user = store.push({
      data: {
        type: 'user',
        id: '1',
        relationships: {
          contacts: {
            data: [{ type: 'contact', id: '1' }],
          },
        },
      },
      included: [
        {
          type: 'contact',
          id: '1',
        },
      ],
    });
    const contacts = await user.contacts;
    assert.strictEqual(contacts.get('length'), 1, 'The contacts relationship is correctly set up');
  });

  test('Type can be inferred from the key of an async hasMany relationship', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('user').reopen({
      contacts: hasMany({ async: true }),
    });

    adapter.findRecord = function (store, type, ids, snapshots) {
      return {
        data: {
          id: 1,
          type: 'user',
          relationships: {
            contacts: {
              data: [{ id: 1, type: 'contact' }],
            },
          },
        },
      };
    };

    run(function () {
      store.push({
        data: {
          type: 'user',
          id: '1',
          relationships: {
            contacts: {
              data: [{ type: 'contact', id: '1' }],
            },
          },
        },
        included: [
          {
            type: 'contact',
            id: '1',
          },
        ],
      });
    });
    run(function () {
      store
        .findRecord('user', 1)
        .then(function (user) {
          return user.get('contacts');
        })
        .then(function (contacts) {
          assert.strictEqual(contacts.get('length'), 1, 'The contacts relationship is correctly set up');
        });
    });
  });

  test('Polymorphic relationships work with a hasMany whose type is inferred', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('user').reopen({
      contacts: hasMany({ polymorphic: true, async: false }),
    });

    adapter.findRecord = function (store, type, ids, snapshots) {
      return { data: { id: 1, type: 'user' } };
    };

    run(function () {
      store.push({
        data: {
          type: 'user',
          id: '1',
          relationships: {
            contacts: {
              data: [
                { type: 'email', id: '1' },
                { type: 'phone', id: '2' },
              ],
            },
          },
        },
        included: [
          {
            type: 'email',
            id: '1',
          },
          {
            type: 'phone',
            id: '2',
          },
        ],
      });
    });
    run(function () {
      store
        .findRecord('user', 1)
        .then(function (user) {
          return user.get('contacts');
        })
        .then(function (contacts) {
          assert.strictEqual(contacts.get('length'), 2, 'The contacts relationship is correctly set up');
        });
    });
  });

  test('Polymorphic relationships with a hasMany is set up correctly on both sides', function (assert) {
    assert.expect(2);

    let store = this.owner.lookup('service:store');

    store.modelFor('contact').reopen({
      posts: hasMany('post', { async: false }),
    });

    store.modelFor('post').reopen({
      contact: belongsTo('contact', { polymorphic: true, async: false }),
    });

    let email = store.createRecord('email');
    let post = store.createRecord('post', {
      contact: email,
    });

    assert.strictEqual(post.get('contact'), email, 'The polymorphic belongsTo is set up correctly');
    assert.strictEqual(get(email, 'posts.length'), 1, 'The inverse has many is set up correctly on the email side.');
  });

  testInDebug('Only records of the same type can be added to a monomorphic hasMany relationship', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.shouldBackgroundReloadRecord = () => false;

    run(function () {
      store.push({
        data: [
          {
            type: 'post',
            id: '1',
            relationships: {
              comments: {
                data: [],
              },
            },
          },
          {
            type: 'post',
            id: '2',
          },
        ],
      });
    });

    run(function () {
      all([store.findRecord('post', 1), store.findRecord('post', 2)]).then(function (records) {
        assert.expectAssertion(function () {
          records[0].get('comments').pushObject(records[1]);
        }, /The 'post' type does not implement 'comment' and thus cannot be assigned to the 'comments' relationship in 'post'/);
      });
    });
  });

  testInDebug(
    'Only records of the same base modelClass can be added to a polymorphic hasMany relationship',
    function (assert) {
      assert.expect(2);

      let store = this.owner.lookup('service:store');
      let adapter = store.adapterFor('application');

      adapter.shouldBackgroundReloadRecord = () => false;

      run(function () {
        store.push({
          data: [
            {
              type: 'user',
              id: '1',
              relationships: {
                messages: {
                  data: [],
                },
              },
            },
            {
              type: 'user',
              id: '2',
              relationships: {
                messages: {
                  data: [],
                },
              },
            },
          ],
          included: [
            {
              type: 'post',
              id: '1',
              relationships: {
                comments: {
                  data: [],
                },
              },
            },
            {
              type: 'comment',
              id: '3',
            },
          ],
        });
      });
      let asyncRecords;

      run(function () {
        asyncRecords = hash({
          user: store.findRecord('user', 1),
          anotherUser: store.findRecord('user', 2),
          post: store.findRecord('post', 1),
          comment: store.findRecord('comment', 3),
        });

        asyncRecords
          .then(function (records) {
            records.messages = records.user.get('messages');
            return hash(records);
          })
          .then(function (records) {
            records.messages.pushObject(records.post);
            records.messages.pushObject(records.comment);
            assert.strictEqual(records.messages.get('length'), 2, 'The messages are correctly added');

            assert.expectAssertion(function () {
              records.messages.pushObject(records.anotherUser);
            }, /The 'user' type does not implement 'message' and thus cannot be assigned to the 'messages' relationship in 'user'. Make it a descendant of 'message'/);
          });
      });
    }
  );

  test('A record can be removed from a polymorphic association', async function (assert) {
    assert.expect(4);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.shouldBackgroundReloadRecord = () => false;

    const [user, comment] = store.push({
      data: [
        {
          type: 'user',
          id: '1',
          relationships: {
            messages: {
              data: [{ type: 'comment', id: '3' }],
            },
          },
        },
        {
          type: 'comment',
          id: '3',
          attributes: {},
        },
      ],
    });

    const messages = await user.messages;

    assert.strictEqual(messages.get('length'), 1, 'The user has 1 message');

    let removedObject = messages.popObject();

    assert.strictEqual(removedObject, comment, 'The message is correctly removed');
    assert.strictEqual(messages.get('length'), 0, 'The user does not have any messages');
    assert.strictEqual(messages.objectAt(0), undefined, "Null messages can't be fetched");
  });

  test('When a record is created on the client, its hasMany arrays should be in a loaded state', function (assert) {
    assert.expect(3);

    let store = this.owner.lookup('service:store');
    let post = store.createRecord('post');

    assert.ok(get(post, 'isLoaded'), 'The post should have isLoaded flag');
    let comments;
    run(function () {
      comments = get(post, 'comments');
    });

    assert.strictEqual(get(comments, 'length'), 0, 'The comments should be an empty array');

    assert.ok(get(comments, 'isLoaded'), 'The comments should have isLoaded flag');
  });

  test('When a record is created on the client, its async hasMany arrays should be in a loaded state', function (assert) {
    assert.expect(4);

    let store = this.owner.lookup('service:store');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    let post = store.createRecord('post');

    assert.ok(get(post, 'isLoaded'), 'The post should have isLoaded flag');

    run(function () {
      get(post, 'comments').then(function (comments) {
        assert.ok(true, 'Comments array successfully resolves');
        assert.strictEqual(get(comments, 'length'), 0, 'The comments should be an empty array');
        assert.ok(get(comments, 'isLoaded'), 'The comments should have isLoaded flag');
      });
    });
  });

  test('we can set records SYNC HM relationship', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let post = store.createRecord('post');

    run(function () {
      store.push({
        data: [
          {
            type: 'comment',
            id: '1',
            attributes: {
              body: 'First',
            },
          },
          {
            type: 'comment',
            id: '2',
            attributes: {
              body: 'Second',
            },
          },
        ],
      });
      post.set('comments', store.peekAll('comment'));
    });

    assert.strictEqual(get(post, 'comments.length'), 2, 'we can set HM relationship');
  });

  test('We can set records ASYNC HM relationship', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    let post = store.createRecord('post');

    run(function () {
      store.push({
        data: [
          {
            type: 'comment',
            id: '1',
            attributes: {
              body: 'First',
            },
          },
          {
            type: 'comment',
            id: '2',
            attributes: {
              body: 'Second',
            },
          },
        ],
      });
      post.set('comments', store.peekAll('comment'));
    });

    return post.get('comments').then((comments) => {
      assert.strictEqual(comments.get('length'), 2, 'we can set async HM relationship');
    });
  });

  test('When a record is saved, its unsaved hasMany records should be kept', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.createRecord = function (store, type, snapshot) {
      return resolve({ data: { id: 1, type: snapshot.modelName } });
    };

    let post, comment;
    return run(() => {
      post = store.createRecord('post');
      comment = store.createRecord('comment');
      post.get('comments').pushObject(comment);
      return post.save();
    }).then(() => {
      assert.strictEqual(get(post, 'comments.length'), 1, "The unsaved comment should be in the post's comments array");
    });
  });

  test('dual non-async HM <-> BT', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { inverse: 'post', async: false }),
    });

    store.modelFor('comment').reopen({
      post: belongsTo('post', { async: false }),
    });

    adapter.createRecord = function (store, type, snapshot) {
      let serialized = snapshot.record.serialize();
      serialized.data.id = 2;
      return resolve(serialized);
    };

    let post, firstComment;

    run(function () {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              data: [{ type: 'comment', id: '1' }],
            },
          },
        },
      });
      store.push({
        data: {
          type: 'comment',
          id: '1',
          relationships: {
            comments: {
              post: { type: 'post', id: '1' },
            },
          },
        },
      });

      post = store.peekRecord('post', 1);
      firstComment = store.peekRecord('comment', 1);

      store
        .createRecord('comment', {
          post: post,
        })
        .save()
        .then(function (comment) {
          let commentPost = comment.get('post');
          let postComments = comment.get('post.comments');
          let postCommentsLength = comment.get('post.comments.length');

          assert.deepEqual(post, commentPost, 'expect the new comments post, to be the correct post');
          assert.ok(postComments, 'comments should exist');
          assert.strictEqual(postCommentsLength, 2, "comment's post should have a internalModel back to comment");
          assert.ok(postComments && postComments.indexOf(firstComment) !== -1, 'expect to contain first comment');
          assert.ok(postComments && postComments.indexOf(comment) !== -1, 'expected to contain the new comment');
        });
    });
  });

  test('When an unloaded record is added to the hasMany, it gets fetched once the hasMany is accessed even if the hasMany has been already fetched', async function (assert) {
    assert.expect(6);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    let findManyCalls = 0;
    let findRecordCalls = 0;

    adapter.findMany = function (store, type, ids, snapshots) {
      assert.ok(true, `findMany called ${++findManyCalls}x`);
      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'first' } },
          { id: 2, type: 'comment', attributes: { body: 'second' } },
        ],
      });
    };

    adapter.findRecord = function (store, type, id, snapshot) {
      assert.ok(true, `findRecord called ${++findRecordCalls}x`);

      return resolve({ data: { id: 3, type: 'comment', attributes: { body: 'third' } } });
    };

    let post = store.push({
      data: {
        type: 'post',
        id: '1',
        relationships: {
          comments: {
            data: [
              { type: 'comment', id: '1' },
              { type: 'comment', id: '2' },
            ],
          },
        },
      },
    });

    let fetchedComments = await post.get('comments');

    assert.strictEqual(fetchedComments.get('length'), 2, 'comments fetched successfully');
    assert.strictEqual(fetchedComments.objectAt(0).get('body'), 'first', 'first comment loaded successfully');

    store.push({
      data: {
        type: 'post',
        id: '1',
        relationships: {
          comments: {
            data: [
              { type: 'comment', id: '1' },
              { type: 'comment', id: '2' },
              { type: 'comment', id: '3' },
            ],
          },
        },
      },
    });

    let newlyFetchedComments = await post.get('comments');

    assert.strictEqual(newlyFetchedComments.get('length'), 3, 'all three comments fetched successfully');
    assert.strictEqual(newlyFetchedComments.objectAt(2).get('body'), 'third', 'third comment loaded successfully');
  });

  testInDebug('A sync hasMany errors out if there are unloaded records in it', function (assert) {
    let store = this.owner.lookup('service:store');

    let post = store.push({
      data: {
        type: 'post',
        id: '1',
        relationships: {
          comments: {
            data: [
              { type: 'comment', id: '1' },
              { type: 'comment', id: '2' },
            ],
          },
        },
      },
    });

    const assertionMessage =
      /You looked up the 'comments' relationship on a 'post' with id 1 but some of the associated records were not loaded./;

    try {
      post.get('comments');
      assert.ok(false, 'expected assertion');
    } catch (e) {
      assert.ok(assertionMessage.test(e.message), 'correct assertion');
    }
  });

  test('After removing and unloading a record, a hasMany relationship should still be valid', function (assert) {
    let store = this.owner.lookup('service:store');

    const post = run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              data: [{ type: 'comment', id: '1' }],
            },
          },
        },
        included: [{ type: 'comment', id: '1' }],
      });
      const post = store.peekRecord('post', 1);
      const comments = post.get('comments');
      const comment = comments.objectAt(0);
      comments.removeObject(comment);
      store.unloadRecord(comment);
      assert.strictEqual(comments.get('length'), 0);
      return post;
    });

    // Explicitly re-get comments
    assert.strictEqual(run(post, 'get', 'comments.length'), 0);
  });

  test('If reordered hasMany data has been pushed to the store, the many array reflects the ordering change - sync', function (assert) {
    let store = this.owner.lookup('service:store');

    let comment1, comment2, comment3, comment4;
    let post;

    run(() => {
      store.push({
        data: [
          {
            type: 'comment',
            id: '1',
          },
          {
            type: 'comment',
            id: '2',
          },
          {
            type: 'comment',
            id: '3',
          },
          {
            type: 'comment',
            id: '4',
          },
        ],
      });

      comment1 = store.peekRecord('comment', 1);
      comment2 = store.peekRecord('comment', 2);
      comment3 = store.peekRecord('comment', 3);
      comment4 = store.peekRecord('comment', 4);
    });

    run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              data: [
                { type: 'comment', id: '1' },
                { type: 'comment', id: '2' },
              ],
            },
          },
        },
      });
      post = store.peekRecord('post', 1);

      assert.deepEqual(post.get('comments').toArray(), [comment1, comment2], 'Initial ordering is correct');
    });

    run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              data: [
                { type: 'comment', id: '2' },
                { type: 'comment', id: '1' },
              ],
            },
          },
        },
      });
    });
    assert.deepEqual(post.get('comments').toArray(), [comment2, comment1], 'Updated ordering is correct');

    run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              data: [{ type: 'comment', id: '2' }],
            },
          },
        },
      });
    });
    assert.deepEqual(post.get('comments').toArray(), [comment2], 'Updated ordering is correct');

    run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              data: [
                { type: 'comment', id: '1' },
                { type: 'comment', id: '2' },
                { type: 'comment', id: '3' },
                { type: 'comment', id: '4' },
              ],
            },
          },
        },
      });
    });
    assert.deepEqual(
      post.get('comments').toArray(),
      [comment1, comment2, comment3, comment4],
      'Updated ordering is correct'
    );

    run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              data: [
                { type: 'comment', id: '4' },
                { type: 'comment', id: '3' },
              ],
            },
          },
        },
      });
    });
    assert.deepEqual(post.get('comments').toArray(), [comment4, comment3], 'Updated ordering is correct');

    run(() => {
      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              data: [
                { type: 'comment', id: '4' },
                { type: 'comment', id: '2' },
                { type: 'comment', id: '3' },
                { type: 'comment', id: '1' },
              ],
            },
          },
        },
      });
    });

    assert.deepEqual(
      post.get('comments').toArray(),
      [comment4, comment2, comment3, comment1],
      'Updated ordering is correct'
    );
  });

  test('Rollbacking attributes for deleted record restores implicit relationship correctly when the hasMany side has been deleted - async', function (assert) {
    let store = this.owner.lookup('service:store');

    let book, chapter;

    run(() => {
      store.push({
        data: {
          type: 'book',
          id: '1',
          attributes: {
            title: "Stanley's Amazing Adventures",
          },
          relationships: {
            chapters: {
              data: [{ type: 'chapter', id: '2' }],
            },
          },
        },
        included: [
          {
            type: 'chapter',
            id: '2',
            attributes: {
              title: 'Sailing the Seven Seas',
            },
          },
        ],
      });
      book = store.peekRecord('book', 1);
      chapter = store.peekRecord('chapter', 2);
    });

    run(() => {
      chapter.deleteRecord();
      chapter.rollbackAttributes();
    });

    return run(() => {
      return book.get('chapters').then((fetchedChapters) => {
        assert.strictEqual(fetchedChapters.objectAt(0), chapter, 'Book has a chapter after rollback attributes');
      });
    });
  });

  test('Rollbacking attributes for deleted record restores implicit relationship correctly when the hasMany side has been deleted - sync', function (assert) {
    let store = this.owner.lookup('service:store');

    let book, chapter;

    run(() => {
      store.push({
        data: {
          type: 'book',
          id: '1',
          attributes: {
            title: "Stanley's Amazing Adventures",
          },
          relationships: {
            chapters: {
              data: [{ type: 'chapter', id: '2' }],
            },
          },
        },
        included: [
          {
            type: 'chapter',
            id: '2',
            attributes: {
              title: 'Sailing the Seven Seas',
            },
          },
        ],
      });
      book = store.peekRecord('book', 1);
      chapter = store.peekRecord('chapter', 2);
    });

    run(() => {
      chapter.deleteRecord();
      chapter.rollbackAttributes();
    });

    run(() => {
      assert.strictEqual(book.get('chapters.firstObject'), chapter, 'Book has a chapter after rollback attributes');
    });
  });

  test('Rollbacking attributes for deleted record restores implicit relationship correctly when the belongsTo side has been deleted - async', function (assert) {
    let store = this.owner.lookup('service:store');

    store.modelFor('page').reopen({
      chapter: belongsTo('chapter', { async: true }),
    });

    let chapter, page;

    run(() => {
      store.push({
        data: {
          type: 'chapter',
          id: '2',
          attributes: {
            title: 'Sailing the Seven Seas',
          },
        },
        included: [
          {
            type: 'page',
            id: '3',
            attributes: {
              number: 1,
            },
            relationships: {
              chapter: {
                data: { type: 'chapter', id: '2' },
              },
            },
          },
        ],
      });
      chapter = store.peekRecord('chapter', 2);
      page = store.peekRecord('page', 3);
    });

    run(() => {
      chapter.deleteRecord();
      chapter.rollbackAttributes();
    });

    return run(() => {
      return page.get('chapter').then((fetchedChapter) => {
        assert.strictEqual(fetchedChapter, chapter, 'Page has a chapter after rollback attributes');
      });
    });
  });

  test('Rollbacking attributes for deleted record restores implicit relationship correctly when the belongsTo side has been deleted - sync', function (assert) {
    let store = this.owner.lookup('service:store');

    let chapter, page;
    run(() => {
      store.push({
        data: {
          type: 'chapter',
          id: '2',
          attributes: {
            title: 'Sailing the Seven Seas',
          },
        },
        included: [
          {
            type: 'page',
            id: '3',
            attributes: {
              number: 1,
            },
            relationships: {
              chapter: {
                data: { type: 'chapter', id: '2' },
              },
            },
          },
        ],
      });
      chapter = store.peekRecord('chapter', 2);
      page = store.peekRecord('page', 3);
    });

    run(() => {
      chapter.deleteRecord();
      chapter.rollbackAttributes();
    });

    run(() => {
      assert.strictEqual(page.get('chapter'), chapter, 'Page has a chapter after rollback attributes');
    });
  });

  test('ManyArray notifies the array observers and flushes bindings when removing', function (assert) {
    assert.expect(3);
    assert.expectDeprecation(
      () => {
        let store = this.owner.lookup('service:store');

        let chapter, page2;
        let observe = false;

        run(() => {
          store.push({
            data: [
              {
                type: 'page',
                id: '1',
                attributes: {
                  number: 1,
                },
              },
              {
                type: 'page',
                id: '2',
                attributes: {
                  number: 2,
                },
              },
              {
                type: 'chapter',
                id: '1',
                attributes: {
                  title: 'Sailing the Seven Seas',
                },
                relationships: {
                  pages: {
                    data: [
                      { type: 'page', id: '1' },
                      { type: 'page', id: '2' },
                    ],
                  },
                },
              },
            ],
          });
          let page = store.peekRecord('page', 1);
          page2 = store.peekRecord('page', 2);
          chapter = store.peekRecord('chapter', 1);

          chapter.get('pages').addArrayObserver(this, {
            willChange(pages, index, removeCount, addCount) {
              if (observe) {
                assert.strictEqual(pages.objectAt(index), page2, 'page2 is passed to willChange');
              }
            },
            didChange(pages, index, removeCount, addCount) {
              if (observe) {
                assert.strictEqual(removeCount, 1, 'removeCount is correct');
              }
            },
          });
        });

        run(() => {
          observe = true;
          page2.set('chapter', null);
          observe = false;
        });
      },
      { id: 'array-observers', count: 1, when: { ember: '>=3.26.0' } }
    );
  });

  test('ManyArray notifies the array observers and flushes bindings when adding', function (assert) {
    assert.expect(3);
    assert.expectDeprecation(
      () => {
        let store = this.owner.lookup('service:store');

        let chapter, page2;
        let observe = false;

        run(() => {
          store.push({
            data: [
              {
                type: 'page',
                id: '1',
                attributes: {
                  number: 1,
                },
              },
              {
                type: 'page',
                id: '2',
                attributes: {
                  number: 2,
                },
              },
              {
                type: 'chapter',
                id: '1',
                attributes: {
                  title: 'Sailing the Seven Seas',
                },
                relationships: {
                  pages: {
                    data: [{ type: 'page', id: '1' }],
                  },
                },
              },
            ],
          });
          let page = store.peekRecord('page', 1);
          page2 = store.peekRecord('page', 2);
          chapter = store.peekRecord('chapter', 1);

          chapter.get('pages').addArrayObserver(this, {
            willChange(pages, index, removeCount, addCount) {
              if (observe) {
                assert.strictEqual(addCount, 1, 'addCount is correct');
              }
            },
            didChange(pages, index, removeCount, addCount) {
              if (observe) {
                assert.strictEqual(pages.objectAt(index), page2, 'page2 is passed to didChange');
              }
            },
          });
        });

        run(() => {
          observe = true;
          page2.set('chapter', chapter);
          observe = false;
        });
      },
      { id: 'array-observers', count: 1, when: { ember: '>=3.26.0' } }
    );
  });

  testInDebug('Passing a model as type to hasMany should not work', function (assert) {
    assert.expect(1);

    assert.expectAssertion(() => {
      const User = Model.extend();

      Model.extend({
        users: hasMany(User, { async: false }),
      });
    }, /The first argument to hasMany must be a string/);
  });

  test('Relationship.clear removes all records correctly', async function (assert) {
    let store = this.owner.lookup('service:store');

    store.modelFor('comment').reopen({
      post: belongsTo('post', { async: false }),
    });

    store.modelFor('post').reopen({
      comments: hasMany('comment', { inverse: 'post', async: false }),
    });

    const [post] = store.push({
      data: [
        {
          type: 'post',
          id: '2',
          attributes: {
            title: 'Sailing the Seven Seas',
          },
          relationships: {
            comments: {
              data: [
                { type: 'comment', id: '1' },
                { type: 'comment', id: '2' },
              ],
            },
          },
        },
        {
          type: 'comment',
          id: '1',
          relationships: {
            post: {
              data: { type: 'post', id: '2' },
            },
          },
        },
        {
          type: 'comment',
          id: '2',
          relationships: {
            post: {
              data: { type: 'post', id: '2' },
            },
          },
        },
        {
          type: 'comment',
          id: '3',
          relationships: {
            post: {
              data: { type: 'post', id: '2' },
            },
          },
        },
      ],
    });

    const comments = store.peekAll('comment');
    assert.deepEqual(comments.mapBy('post.id'), ['2', '2', '2']);

    const postComments = await post.comments;
    postComments.clear();

    assert.deepEqual(comments.mapBy('post'), [null, null, null]);
  });

  test('unloading a record with associated records does not prevent the store from tearing down', function (assert) {
    let store = this.owner.lookup('service:store');

    store.modelFor('comment').reopen({
      post: belongsTo('post', { async: false }),
    });

    store.modelFor('post').reopen({
      comments: hasMany('comment', { inverse: 'post', async: false }),
    });

    let post;
    run(() => {
      store.push({
        data: [
          {
            type: 'post',
            id: '2',
            attributes: {
              title: 'Sailing the Seven Seas',
            },
            relationships: {
              comments: {
                data: [
                  { type: 'comment', id: '1' },
                  { type: 'comment', id: '2' },
                ],
              },
            },
          },
          {
            type: 'comment',
            id: '1',
            relationships: {
              post: {
                data: { type: 'post', id: '2' },
              },
            },
          },
          {
            type: 'comment',
            id: '2',
            relationships: {
              post: {
                data: { type: 'post', id: '2' },
              },
            },
          },
        ],
      });
      post = store.peekRecord('post', 2);

      // This line triggers the original bug that gets manifested
      // in teardown for apps, e.g. store.destroy that is caused by
      // App.destroy().
      // Relationship#clear uses Ember.Set#forEach, which does incorrect
      // iteration when the set is being mutated (in our case, the index gets off
      // because records are being removed)
      store.unloadRecord(post);
    });

    try {
      run(() => {
        store.destroy();
      });
      assert.ok(true, 'store destroyed correctly');
    } catch (error) {
      assert.ok(false, 'store prevented from being destroyed');
    }
  });

  test('adding and removing records from hasMany relationship #2666', async function (assert) {
    assert.expect(4);

    const Post = Model.extend({
      comments: hasMany('comment', { async: true }),
      toString: () => 'Post',
    });

    const Comment = Model.extend({
      post: belongsTo('post', { async: false }),
      toString: () => 'Comment',
    });

    const ApplicationAdapter = RESTAdapter.extend({
      shouldBackgroundReloadRecord: () => false,
    });

    let commentId = 4;
    this.owner.register(
      'adapter:comment',
      RESTAdapter.extend({
        deleteRecord(record) {
          return resolve();
        },
        updateRecord(record) {
          return resolve();
        },
        createRecord() {
          return resolve({ comments: { id: commentId++ } });
        },
      })
    );

    this.owner.register('model:post', Post);
    this.owner.register('model:comment', Comment);

    this.owner.register('adapter:application', ApplicationAdapter);
    this.owner.register('serializer:application', RESTSerializer.extend());

    let store = this.owner.lookup('service:store');

    run(() => {
      store.push({
        data: [
          {
            type: 'post',
            id: '1',
            relationships: {
              comments: {
                data: [
                  { type: 'comment', id: '1' },
                  { type: 'comment', id: '2' },
                  { type: 'comment', id: '3' },
                ],
              },
            },
          },
          {
            type: 'comment',
            id: '1',
          },
          {
            type: 'comment',
            id: '2',
          },
          {
            type: 'comment',
            id: '3',
          },
        ],
      });
    });

    return run(() => {
      return store.findRecord('post', 1).then((post) => {
        let comments = post.get('comments');
        assert.strictEqual(comments.get('length'), 3, 'Initial comments count');

        // Add comment #4
        let comment = store.createRecord('comment');
        comments.addObject(comment);

        return comment
          .save()
          .then(() => {
            let comments = post.get('comments');
            assert.strictEqual(comments.get('length'), 4, 'Comments count after first add');

            // Delete comment #4
            return comments.get('lastObject').destroyRecord();
          })
          .then(() => {
            let comments = post.get('comments');
            let length = comments.get('length');

            assert.strictEqual(length, 3, 'Comments count after destroy');

            // Add another comment #4
            let comment = store.createRecord('comment');
            comments.addObject(comment);
            return comment.save();
          })
          .then(() => {
            let comments = post.get('comments');
            assert.strictEqual(comments.get('length'), 4, 'Comments count after second add');
          });
      });
    });
  });

  test('hasMany hasAnyRelationshipData async loaded', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('chapter').reopen({
      pages: hasMany('pages', { async: true }),
    });

    adapter.findRecord = function (store, type, id, snapshot) {
      return resolve({
        data: {
          id: 1,
          type: 'chapter',
          attributes: { title: 'The Story Begins' },
          relationships: {
            pages: {
              data: [
                { id: 2, type: 'page' },
                { id: 3, type: 'page' },
              ],
            },
          },
        },
      });
    };

    return run(() => {
      return store.findRecord('chapter', 1).then((chapter) => {
        let relationship = getRelationshipStateForRecord(chapter, 'pages');
        assert.true(relationship.state.hasReceivedData, 'relationship has data');
      });
    });
  });

  test('hasMany hasAnyRelationshipData sync loaded', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.findRecord = function (store, type, id, snapshot) {
      return resolve({
        data: {
          id: 1,
          type: 'chapter',
          attributes: { title: 'The Story Begins' },
          relationships: {
            pages: {
              data: [
                { id: 2, type: 'page' },
                { id: 3, type: 'page' },
              ],
            },
          },
        },
      });
    };

    return run(() => {
      return store.findRecord('chapter', 1).then((chapter) => {
        let relationship = getRelationshipStateForRecord(chapter, 'pages');
        assert.true(relationship.state.hasReceivedData, 'relationship has data');
      });
    });
  });

  test('hasMany hasAnyRelationshipData async not loaded', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('chapter').reopen({
      pages: hasMany('pages', { async: true }),
    });

    adapter.findRecord = function (store, type, id, snapshot) {
      return resolve({
        data: {
          id: 1,
          type: 'chapter',
          attributes: { title: 'The Story Begins' },
          relationships: {
            pages: {
              links: { related: 'pages' },
            },
          },
        },
      });
    };

    return run(() => {
      return store.findRecord('chapter', 1).then((chapter) => {
        let relationship = getRelationshipStateForRecord(chapter, 'pages');
        assert.false(relationship.state.hasReceivedData, 'relationship does not have data');
      });
    });
  });

  test('hasMany hasAnyRelationshipData sync not loaded', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.findRecord = function (store, type, id, snapshot) {
      return resolve({
        data: {
          id: 1,
          type: 'chapter',
          attributes: { title: 'The Story Begins' },
        },
      });
    };

    return run(() => {
      return store.findRecord('chapter', 1).then((chapter) => {
        let relationship = getRelationshipStateForRecord(chapter, 'pages');
        assert.false(relationship.state.hasReceivedData, 'relationship does not have data');
      });
    });
  });

  test('hasMany hasAnyRelationshipData async created', function (assert) {
    assert.expect(2);

    let store = this.owner.lookup('service:store');

    store.modelFor('chapter').reopen({
      pages: hasMany('pages', { async: true }),
    });

    let chapter = store.createRecord('chapter', { title: 'The Story Begins' });
    let page = store.createRecord('page');

    let relationship = getRelationshipStateForRecord(chapter, 'pages');
    assert.false(relationship.state.hasReceivedData, 'relationship does not have data');

    chapter = store.createRecord('chapter', {
      title: 'The Story Begins',
      pages: [page],
    });

    relationship = getRelationshipStateForRecord(chapter, 'pages');
    assert.true(relationship.state.hasReceivedData, 'relationship has data');
  });

  test('hasMany hasAnyRelationshipData sync created', function (assert) {
    assert.expect(2);

    let store = this.owner.lookup('service:store');
    let chapter = store.createRecord('chapter', { title: 'The Story Begins' });
    let relationship = getRelationshipStateForRecord(chapter, 'pages');

    assert.false(relationship.state.hasReceivedData, 'relationship does not have data');

    chapter = store.createRecord('chapter', {
      title: 'The Story Begins',
      pages: [store.createRecord('page')],
    });
    relationship = getRelationshipStateForRecord(chapter, 'pages');

    assert.true(relationship.state.hasReceivedData, 'relationship has data');
  });

  test("Model's hasMany relationship should not be created during model creation", function (assert) {
    let store = this.owner.lookup('service:store');

    let user;
    run(() => {
      store.push({
        data: {
          type: 'user',
          id: '1',
        },
      });
      user = store.peekRecord('user', 1);
      assert.notOk(hasRelationshipForRecord(user, 'messages'), 'Newly created record should not have relationships');
    });
  });

  test("Model's belongsTo relationship should be created during 'get' method", function (assert) {
    let store = this.owner.lookup('service:store');

    let user;
    run(() => {
      user = store.createRecord('user');
      user.get('messages');
      assert.ok(
        hasRelationshipForRecord(user, 'messages'),
        'Newly created record with relationships in params passed in its constructor should have relationships'
      );
    });
  });

  test('metadata is accessible when pushed as a meta property for a relationship', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.findHasMany = function () {
      return resolve({});
    };

    let book;
    run(() => {
      store.push({
        data: {
          type: 'book',
          id: '1',
          attributes: {
            title: 'Sailing the Seven Seas',
          },
          relationships: {
            chapters: {
              meta: {
                where: 'the lefkada sea',
              },
              links: {
                related: '/chapters',
              },
            },
          },
        },
      });
      book = store.peekRecord('book', 1);
    });

    run(() => {
      assert.strictEqual(
        getRelationshipStateForRecord(book, 'chapters').meta.where,
        'the lefkada sea',
        'meta is there'
      );
    });
  });

  test('metadata is accessible when return from a fetchLink', function (assert) {
    assert.expect(1);

    this.owner.register('serializer:application', RESTSerializer);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    adapter.findHasMany = function () {
      return resolve({
        meta: {
          foo: 'bar',
        },
        chapters: [{ id: '2' }, { id: '3' }],
      });
    };

    let book;

    run(() => {
      store.push({
        data: {
          type: 'book',
          id: '1',
          attributes: {
            title: 'Sailing the Seven Seas',
          },
          relationships: {
            chapters: {
              links: {
                related: '/chapters',
              },
            },
          },
        },
      });
      book = store.peekRecord('book', 1);
    });

    return run(() => {
      return book.get('chapters').then((chapters) => {
        let meta = chapters.get('meta');
        assert.strictEqual(get(meta, 'foo'), 'bar', 'metadata is available');
      });
    });
  });

  test('metadata should be reset between requests', function (assert) {
    this.owner.register('serializer:application', RESTSerializer);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    let counter = 0;

    adapter.findHasMany = function () {
      let data = {
        meta: {
          foo: 'bar',
        },
        chapters: [{ id: '2' }, { id: '3' }],
      };

      assert.ok(true, 'findHasMany should be called twice');

      if (counter === 1) {
        delete data.meta;
      }

      counter++;

      return resolve(data);
    };

    let book1, book2;

    run(() => {
      store.push({
        data: [
          {
            type: 'book',
            id: '1',
            attributes: {
              title: 'Sailing the Seven Seas',
            },
            relationships: {
              chapters: {
                links: {
                  related: 'chapters',
                },
              },
            },
          },
          {
            type: 'book',
            id: '2',
            attributes: {
              title: 'Another book title',
            },
            relationships: {
              chapters: {
                links: {
                  related: 'chapters',
                },
              },
            },
          },
        ],
      });
      book1 = store.peekRecord('book', 1);
      book2 = store.peekRecord('book', 2);
    });

    return run(() => {
      return book1.get('chapters').then((chapters) => {
        let meta = chapters.get('meta');
        assert.strictEqual(get(meta, 'foo'), 'bar', 'metadata should available');

        return book2.get('chapters').then((chapters) => {
          let meta = chapters.get('meta');
          assert.strictEqual(meta, null, 'metadata should not be available');
        });
      });
    });
  });

  test('Related link should be fetched when no relationship data is present', function (assert) {
    assert.expect(3);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true, inverse: 'post' }),
    });

    store.modelFor('comment').reopen({
      post: belongsTo('post', { async: false, inverse: 'comments' }),
    });

    adapter.shouldBackgroundReloadRecord = () => {
      return false;
    };
    adapter.findRecord = () => {
      assert.ok(false, "The adapter's findRecord method should not be called");
    };
    adapter.findMany = () => {
      assert.ok(false, "The adapter's findMany method should not be called");
    };

    adapter.findHasMany = function (store, snapshot, url, relationship) {
      assert.strictEqual(url, 'get-comments', 'url is correct');
      assert.ok(true, "The adapter's findHasMany method should be called");
      return resolve({
        data: [
          {
            id: '1',
            type: 'comment',
            attributes: {
              body: 'This is comment',
            },
          },
        ],
      });
    };

    return run(() => {
      let post = store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: 'get-comments',
              },
            },
          },
        },
      });

      return post.get('comments').then((comments) => {
        assert.strictEqual(comments.get('firstObject.body'), 'This is comment', 'comment body is correct');
      });
    });
  });

  test('Related link should take precedence over relationship data when local record data is missing', function (assert) {
    assert.expect(3);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true, inverse: 'post' }),
    });

    store.modelFor('comment').reopen({
      post: belongsTo('post', { async: false, inverse: 'comments' }),
    });

    adapter.shouldBackgroundReloadRecord = () => {
      return false;
    };
    adapter.findRecord = () => {
      assert.ok(false, "The adapter's findRecord method should not be called");
    };
    adapter.findMany = () => {
      assert.ok(false, "The adapter's findMany method should not be called");
    };

    adapter.findHasMany = function (store, snapshot, url, relationship) {
      assert.strictEqual(url, 'get-comments', 'url is correct');
      assert.ok(true, "The adapter's findHasMany method should be called");
      return resolve({
        data: [
          {
            id: '1',
            type: 'comment',
            attributes: {
              body: 'This is comment',
            },
          },
        ],
      });
    };

    return run(() => {
      let post = store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: 'get-comments',
              },
              data: [{ type: 'comment', id: '1' }],
            },
          },
        },
      });

      return post.get('comments').then((comments) => {
        assert.strictEqual(comments.get('firstObject.body'), 'This is comment', 'comment body is correct');
      });
    });
  });

  test('Local relationship data should take precedence over related link when local record data is available', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true, inverse: 'post' }),
    });

    store.modelFor('comment').reopen({
      post: belongsTo('post', { async: false, inverse: 'comments' }),
    });

    adapter.shouldBackgroundReloadRecord = () => {
      return false;
    };
    adapter.findRecord = () => {
      assert.ok(false, "The adapter's findRecord method should not be called");
    };
    adapter.findMany = () => {
      assert.ok(false, "The adapter's findMany method should not be called");
    };

    adapter.findHasMany = function (store, snapshot, url, relationship) {
      assert.ok(false, "The adapter's findHasMany method should not be called");
    };

    return run(() => {
      let post = store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: 'get-comments',
              },
              data: [{ type: 'comment', id: '1' }],
            },
          },
        },
        included: [
          {
            id: '1',
            type: 'comment',
            attributes: {
              body: 'This is comment',
            },
          },
        ],
      });

      return post.get('comments').then((comments) => {
        assert.strictEqual(comments.get('firstObject.body'), 'This is comment', 'comment body is correct');
      });
    });
  });

  test('Related link should take precedence over local record data when relationship data is not initially available', function (assert) {
    assert.expect(3);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true, inverse: 'post' }),
    });

    store.modelFor('comment').reopen({
      post: belongsTo('post', { async: false, inverse: 'comments' }),
    });

    adapter.shouldBackgroundReloadRecord = () => {
      return false;
    };
    adapter.findRecord = () => {
      assert.ok(false, "The adapter's findRecord method should not be called");
    };
    adapter.findMany = () => {
      assert.ok(false, "The adapter's findMany method should not be called");
    };

    adapter.findHasMany = function (store, snapshot, url, relationship) {
      assert.strictEqual(url, 'get-comments', 'url is correct');
      assert.ok(true, "The adapter's findHasMany method should be called");
      return resolve({
        data: [
          {
            id: '1',
            type: 'comment',
            attributes: {
              body: 'This is comment fetched by link',
            },
          },
        ],
      });
    };

    return run(() => {
      let post = store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: 'get-comments',
              },
            },
          },
        },
        included: [
          {
            id: '1',
            type: 'comment',
            attributes: {
              body: 'This is comment',
            },
            relationships: {
              post: {
                data: {
                  type: 'post',
                  id: '1',
                },
              },
            },
          },
        ],
      });

      return post.get('comments').then((comments) => {
        assert.strictEqual(
          comments.get('firstObject.body'),
          'This is comment fetched by link',
          'comment body is correct'
        );
      });
    });
  });

  test('Updated related link should take precedence over relationship data and local record data', function (assert) {
    assert.expect(3);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findHasMany = function (store, snapshot, url, relationship) {
      assert.strictEqual(url, 'comments-updated-link', 'url is correct');
      assert.ok(true, "The adapter's findHasMany method should be called");
      return resolve({
        data: [{ id: 1, type: 'comment', attributes: { body: 'This is updated comment' } }],
      });
    };

    adapter.findRecord = function (store, type, id, snapshot) {
      assert.ok(false, "The adapter's findRecord method should not be called");
    };

    return run(() => {
      let post = store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: 'comments',
              },
              data: [{ type: 'comment', id: '1' }],
            },
          },
        },
      });

      store.push({
        data: {
          type: 'post',
          id: '1',
          relationships: {
            comments: {
              links: {
                related: 'comments-updated-link',
              },
            },
          },
        },
      });

      return post.get('comments').then((comments) => {
        assert.strictEqual(comments.get('firstObject.body'), 'This is updated comment', 'comment body is correct');
      });
    });
  });

  test('PromiseArray proxies createRecord to its ManyArray before the hasMany is loaded', function (assert) {
    assert.expect(1);

    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    adapter.findHasMany = function (store, record, link, relationship) {
      return resolve({
        data: [
          { id: 1, type: 'comment', attributes: { body: 'First' } },
          { id: 2, type: 'comment', attributes: { body: 'Second' } },
        ],
      });
    };

    return run(() => {
      let post = store.push({
        data: {
          type: 'post',
          id: 1,
          relationships: {
            comments: {
              links: {
                related: 'someLink',
              },
            },
          },
        },
      });

      let comments = post.get('comments');
      comments.createRecord();
      return comments.then((comments) => {
        assert.strictEqual(comments.get('length'), 3, 'comments have 3 length, including new record');
      });
    });
  });

  test('deleteRecord + unloadRecord', async function (assert) {
    let store = this.owner.lookup('service:store');

    store.modelFor('user').reopen({
      posts: hasMany('post', { inverse: null }),
    });

    store.modelFor('post').reopen({
      user: belongsTo('user', { inverse: null, async: false }),
    });

    store.push({
      data: [
        {
          type: 'user',
          id: 'user-1',
          attributes: {
            name: 'Adolfo Builes',
          },
          relationships: {
            posts: {
              data: [
                { type: 'post', id: 'post-1' },
                { type: 'post', id: 'post-2' },
                { type: 'post', id: 'post-3' },
                { type: 'post', id: 'post-4' },
                { type: 'post', id: 'post-5' },
              ],
            },
          },
        },
        { type: 'post', id: 'post-1' },
        { type: 'post', id: 'post-2' },
        { type: 'post', id: 'post-3' },
        { type: 'post', id: 'post-4' },
        { type: 'post', id: 'post-5' },
      ],
    });

    let user = store.peekRecord('user', 'user-1');
    let posts = user.get('posts');

    store.adapterFor('post').deleteRecord = function () {
      // just acknowledge all deletes, but with a noop
      return { data: null };
    };

    assert.deepEqual(
      posts.map((x) => x.get('id')),
      ['post-1', 'post-2', 'post-3', 'post-4', 'post-5']
    );

    await store
      .peekRecord('post', 'post-2')
      .destroyRecord()
      .then((record) => {
        return store.unloadRecord(record);
      });

    assert.deepEqual(
      posts.map((x) => x.get('id')),
      ['post-1', 'post-3', 'post-4', 'post-5']
    );

    await store
      .peekRecord('post', 'post-3')
      .destroyRecord()
      .then((record) => {
        return store.unloadRecord(record);
      });

    assert.deepEqual(
      posts.map((x) => x.get('id')),
      ['post-1', 'post-4', 'post-5']
    );

    await store.peekRecord('post', 'post-4').destroyRecord();

    assert.deepEqual(
      posts.map((x) => x.get('id')),
      ['post-1', 'post-5']
    );
  });

  test('unloading and reloading a record with hasMany relationship - #3084', function (assert) {
    let store = this.owner.lookup('service:store');

    let user;
    let message;

    run(() => {
      store.push({
        data: [
          {
            type: 'user',
            id: 'user-1',
            attributes: {
              name: 'Adolfo Builes',
            },
            relationships: {
              messages: {
                data: [{ type: 'message', id: 'message-1' }],
              },
            },
          },
          {
            type: 'message',
            id: 'message-1',
          },
        ],
      });

      user = store.peekRecord('user', 'user-1');
      message = store.peekRecord('message', 'message-1');

      assert.strictEqual(get(user, 'messages.firstObject.id'), 'message-1');
      assert.strictEqual(get(message, 'user.id'), 'user-1');
    });

    run(() => {
      store.unloadRecord(user);
    });

    run(() => {
      // The record is resurrected for some reason.
      store.push({
        data: [
          {
            type: 'user',
            id: 'user-1',
            attributes: {
              name: 'Adolfo Builes',
            },
            relationships: {
              messages: {
                data: [{ type: 'message', id: 'message-1' }],
              },
            },
          },
        ],
      });

      user = store.peekRecord('user', 'user-1');

      assert.strictEqual(get(user, 'messages.firstObject.id'), 'message-1', 'user points to message');
      assert.strictEqual(get(message, 'user.id'), 'user-1', 'message points to user');
    });
  });

  test('deleted records should stay deleted', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');
    let user;
    let message;

    adapter.deleteRecord = function (store, type, id) {
      return null;
    };

    run(() => {
      store.push({
        data: [
          {
            type: 'user',
            id: 'user-1',
            attributes: {
              name: 'Adolfo Builes',
            },
            relationships: {
              messages: {
                data: [
                  { type: 'message', id: 'message-1' },
                  { type: 'message', id: 'message-2' },
                ],
              },
            },
          },
          {
            type: 'message',
            id: 'message-1',
          },
          {
            type: 'message',
            id: 'message-2',
          },
        ],
      });

      user = store.peekRecord('user', 'user-1');
      message = store.peekRecord('message', 'message-1');

      assert.strictEqual(get(user, 'messages.length'), 2);
    });

    run(() => message.destroyRecord());

    run(() => {
      // a new message is added to the user should not resurrected the
      // deleted message
      store.push({
        data: [
          {
            type: 'message',
            id: 'message-3',
            relationships: {
              user: {
                data: { type: 'user', id: 'user-1' },
              },
            },
          },
        ],
      });

      assert.deepEqual(
        get(user, 'messages').mapBy('id'),
        ['message-2', 'message-3'],
        'user should have 2 message since 1 was deleted'
      );
    });
  });

  test("hasMany relationship with links doesn't trigger extra change notifications - #4942", function (assert) {
    let store = this.owner.lookup('service:store');

    run(() => {
      store.push({
        data: {
          type: 'book',
          id: '1',
          relationships: {
            chapters: {
              data: [{ type: 'chapter', id: '1' }],
              links: { related: '/book/1/chapters' },
            },
          },
        },
        included: [{ type: 'chapter', id: '1' }],
      });
    });

    let book = store.peekRecord('book', '1');
    let count = 0;

    book.addObserver('chapters', () => {
      count++;
    });

    run(() => {
      book.get('chapters');
    });

    assert.strictEqual(count, 0);
  });

  test('A hasMany relationship with a link will trigger the link request even if a inverse related object is pushed to the store', function (assert) {
    let store = this.owner.lookup('service:store');
    let adapter = store.adapterFor('application');

    store.modelFor('post').reopen({
      comments: hasMany('comment', { async: true }),
    });

    store.modelFor('comment').reopen({
      message: belongsTo('post', { async: true }),
    });

    const postID = '1';

    run(function () {
      // load a record with a link hasMany relationship
      store.push({
        data: {
          type: 'post',
          id: postID,
          relationships: {
            comments: {
              links: {
                related: '/posts/1/comments',
              },
            },
          },
        },
      });

      // if a related comment is pushed into the store,
      // the post.comments.link will not be requested
      //
      // If this comment is not inserted into the store, everything works properly
      store.push({
        data: {
          type: 'comment',
          id: '1',
          attributes: { body: 'First' },
          relationships: {
            message: {
              data: { type: 'post', id: postID },
            },
          },
        },
      });

      adapter.findRecord = function (store, type, id, snapshot) {
        throw new Error(`findRecord for ${type} should not be called`);
      };

      let hasManyCounter = 0;
      adapter.findHasMany = function (store, snapshot, link, relationship) {
        assert.strictEqual(relationship.type, 'comment', 'findHasMany relationship type was Comment');
        assert.strictEqual(relationship.key, 'comments', 'findHasMany relationship key was comments');
        assert.strictEqual(link, '/posts/1/comments', 'findHasMany link was /posts/1/comments');
        hasManyCounter++;

        return resolve({
          data: [
            { id: 1, type: 'comment', attributes: { body: 'First' } },
            { id: 2, type: 'comment', attributes: { body: 'Second' } },
          ],
        });
      };

      const post = store.peekRecord('post', postID);
      post.get('comments').then(function (comments) {
        assert.true(comments.get('isLoaded'), 'comments are loaded');
        assert.strictEqual(hasManyCounter, 1, 'link was requested');
        assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');

        post
          .hasMany('comments')
          .reload()
          .then(function (comments) {
            assert.true(comments.get('isLoaded'), 'comments are loaded');
            assert.strictEqual(hasManyCounter, 2, 'link was requested');
            assert.strictEqual(comments.get('length'), 2, 'comments have 2 length');
          });
      });
    });
  });
});
