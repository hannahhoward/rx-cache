import {
  Observable,
  Subject,
  ReplaySubject,
  Timestamp,
  combineLatest,
  ConnectableObservable
} from 'rxjs'
import {
  map,
  shareReplay,
  switchMap,
  timestamp,
  startWith,
  take,
  flatMap,
  skip,
  merge,
  publish
} from 'rxjs/operators'

const CACHE_SIZE = 1

enum CacheEventType {
  Initial,
  Update,
  Reset
}

interface CacheEventKind<T extends CacheEventType> {
  type: T
  timestamp: T extends CacheEventType.Update ? number : undefined
}

type CacheEvent =
  | CacheEventKind<CacheEventType.Initial>
  | CacheEventKind<CacheEventType.Reset>
  | CacheEventKind<CacheEventType.Update>

function shouldMakeRequest(
  lastRequestEvent: CacheEvent,
  lastResponseEvent: CacheEvent,
  currentTime: number,
  expiry: number
): boolean {
  switch (lastRequestEvent.type) {
    case CacheEventType.Initial:
    case CacheEventType.Reset:
      return true
    default:
      let requestInExpiry = lastRequestEvent.timestamp + expiry < currentTime
      switch (lastResponseEvent.type) {
        case CacheEventType.Initial:
        case CacheEventType.Reset:
          return requestInExpiry
        default:
          return requestInExpiry && lastResponseEvent.timestamp + expiry < currentTime
      }
  }
}

export default class RxCache<T> {
  private requests: Subject<void> = new Subject()
  private requestEvents: Observable<CacheEvent>
  private responses: Observable<T>
  private responseEvents: Observable<CacheEvent>
  private responseReceived: Observable<boolean>
  private resetCache: Subject<void> = new Subject()
  constructor(protected observableOperation$: Observable<T>) {
    // FIXME: explicit typecast is due to
    // https://github.com/ReactiveX/rxjs/issues/2972
    // correct when fixed
    let resetEvents = this.resetCache.pipe(
      map<void, CacheEvent>(_ => ({ type: CacheEventType.Reset, timestamp: undefined })),
      publish()
    ) as ConnectableObservable<CacheEvent>
    resetEvents.connect()

    this.requestEvents = this.requests.pipe(
      timestamp(),
      map<Timestamp<void>, CacheEvent>(timestamp => ({
        type: CacheEventType.Update,
        timestamp: timestamp.timestamp
      })),
      startWith<CacheEvent>({ type: CacheEventType.Initial, timestamp: undefined }),
      merge<CacheEvent>(resetEvents),
      shareReplay(CACHE_SIZE)
    )
    this.responses = this.requests.pipe(
      switchMap(_ => observableOperation$),
      shareReplay(CACHE_SIZE)
    )
    this.responseReceived = this.responses.pipe(
      map(_ => true),
      startWith(false),
      shareReplay(CACHE_SIZE)
    )
    this.responseEvents = this.responses.pipe(
      timestamp(),
      map<Timestamp<T>, CacheEvent>(timestamp => ({
        type: CacheEventType.Update,
        timestamp: timestamp.timestamp
      })),
      startWith<CacheEvent>({ type: CacheEventType.Initial, timestamp: undefined }),
      merge<CacheEvent>(resetEvents),
      shareReplay(CACHE_SIZE)
    )
  }

  invalidateCache(): void {
    this.resetCache.next()
  }

  get(expiry: number = 0, returnExpiredCached: boolean = false): Observable<T> {
    return combineLatest(this.requestEvents, this.responseEvents, this.responseReceived).pipe(
      take(1),
      timestamp(),
      flatMap(({ value: [lastRequestEvent, lastResponseEvent, responseReceived], timestamp }) => {
        if (shouldMakeRequest(lastRequestEvent, lastResponseEvent, timestamp, expiry)) {
          this.requests.next()
          if (responseReceived && !returnExpiredCached) {
            return this.responses.pipe(skip(1))
          }
        }
        return this.responses
      })
    )
  }
}
