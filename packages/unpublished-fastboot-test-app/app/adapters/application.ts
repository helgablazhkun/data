import RESTAdapter from '@ember-data/adapter/rest';

export default class ApplicationAdapter extends RESTAdapter {
  defaultSerializer = 'application';
  namespace = 'api';
  useFetch = false; // no rhyme or reason. Just illustrating the change needed for 4.0 to maintain parity. If want to use fetch, install ember-fetch
}
