import { marbles, cases } from 'rxjs-marbles/jest'
import RxCache from '../src/rx-cache'
import { flatMap, switchMap } from 'rxjs/operators'
import { Observable, empty } from 'rxjs'

/**
 * Dummy test
 */
cases(
  'Basic caching operations',
  (m, c) => {
    let requests = m.hot(c.requests)
    let observableOperation = m.cold(c.operation)
    let expected = c.expected
    let cache = new RxCache(observableOperation)
    const results = requests.pipe(flatMap(_ => cache.get(c.expiry, c.returnExpired)))
    m.expect(results).toBeObservable(expected)
  },
  {
    'fetch for the first time': {
      requests: '^-a-------|',
      operation: '--z|',
      expected: '----z----',
      expiry: 0,
      returnExpired: false
    },
    'cache hit based on expiry': {
      requests: '^-a---b---|',
      operation: '--z|',
      expected: '----z-z---',
      expiry: 2,
      returnExpired: false
    },
    'cache miss based on expiry': {
      requests: '^-a---b---|',
      operation: '--z|',
      expected: '----z---(zz)-',
      expiry: 0,
      returnExpired: false
    },
    'cache miss but no second request based on expiry': {
      requests: '^-a-b-----|',
      operation: '--z|',
      expected: '----(zz)----',
      expiry: 2,
      returnExpired: false
    },
    'cache miss based on expiry w/ return expired': {
      requests: '^-a---b---|',
      operation: '--z|',
      expected: '----z-z-(zz)-',
      expiry: 0,
      returnExpired: true
    },
    'cache miss, second cache miss request already in flight': {
      requests: '^-a---bb--|',
      operation: '--z|',
      expected: '----z---(zzz)-',
      expiry: 1,
      returnExpired: false
    }
  }
)

cases(
  'explicit invalidation of cache',
  (m, c) => {
    let requests = m.hot(c.requests)
    let observableOperation = m.cold(c.operation)
    let expected = c.expected
    let cache = new RxCache(observableOperation)
    const results = requests.pipe(
      flatMap(op => {
        if (op === 'i') {
          cache.invalidateCache()
          return empty()
        } else {
          return cache.get(c.expiry, c.returnExpired)
        }
      })
    )
    m.expect(results).toBeObservable(expected)
  },
  {
    'fetch for the first time': {
      requests: '^-a-i-----|',
      operation: '--z|',
      expected: '----z----',
      expiry: 0,
      returnExpired: false
    },
    'cache invalidated': {
      requests: '^-a---ib---|',
      operation: '--z|',
      expected: '----z----(zz)-',
      expiry: 2,
      returnExpired: false
    },
    'cache miss plus second request based on invalidation': {
      requests: '^-aib-----|',
      operation: '--z|',
      expected: '------(zz)---',
      expiry: 2,
      returnExpired: false
    }
  }
)

cases(
  'subscribing',
  (m, c) => {
    let requests = m.hot(c.requests)
    let triggeredRequests = m.hot(c.triggeredRequests)
    let observableOperation = m.cold(c.operation)
    let expected = c.expected
    let cache = new RxCache(observableOperation)
    cache.subscribeTo(triggeredRequests)
    const results = requests.pipe(flatMap(_ => cache.get(c.expiry, c.returnExpired)))
    m.expect(results).toBeObservable(expected)
  },
  {
    'fetch for the first time, then trigger update': {
      requests: '^-a-------|',
      triggeredRequests: '^-----b----',
      operation: '--z|',
      expected: '----z---z--',
      expiry: 0,
      returnExpired: false
    },
    'fetch for the first time, then trigger update while in flight': {
      requests: '^-a-------|',
      triggeredRequests: '^---b------',
      operation: '--z|',
      expected: '------z--',
      expiry: 0,
      returnExpired: false
    },
    'second request, update already inflight': {
      requests: '^-a----b---|',
      triggeredRequests: '^-----b----',
      operation: '--z|',
      expected: '----z---(zz)--',
      expiry: 1,
      returnExpired: false
    },
    'second request, cache hit, update in flight': {
      requests: '^-a---b---|',
      triggeredRequests: '^-----b----',
      operation: '--z|',
      expected: '----z-z-(zz)--',
      expiry: 2,
      returnExpired: false
    }
  }
)
