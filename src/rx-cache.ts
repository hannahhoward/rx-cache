import { Observable, Subject, pipe, OperatorFunction, merge, of } from 'rxjs'
import {
  map,
  shareReplay,
  switchMap,
  timestamp,
  take,
  flatMap,
  skip,
  scan,
  startWith
} from 'rxjs/operators'

const CACHE_SIZE = 1
const INITIAL_TIME = -1
enum CacheEventType {
  Initial,
  Response,
  Request,
  Reset
}

interface CacheEvent {
  type: CacheEventType
  timestamp: number
}

interface CacheState {
  lastEvent: CacheEventType
  lastEventTimestamp: number
  lastRequestTimestamp: number
  lastResponseTimestamp: number
}

const toCacheEvent = (type: CacheEventType): OperatorFunction<any, CacheEvent> =>
  pipe(timestamp(), map(({ timestamp }) => ({ type, timestamp })))

function shouldMakeRequest(
  cacheState: CacheState,
  currentTime: number,
  ifNotOlderThan: number
): boolean {
  switch (cacheState.lastEvent) {
    case CacheEventType.Initial:
    case CacheEventType.Reset:
      return true
    default:
      return (
        cacheState.lastRequestTimestamp + ifNotOlderThan < currentTime &&
        cacheState.lastResponseTimestamp + ifNotOlderThan < currentTime
      )
  }
}

export default class RxCache<T> {
  private requests$: Subject<void> = new Subject()
  private cacheState$: Observable<CacheState>
  private responses$: Observable<T>
  private resetCacheRequests$: Subject<void> = new Subject()
  constructor(protected observableOperation$: Observable<T>) {
    this.responses$ = this.requests$.pipe(
      switchMap(_ => observableOperation$),
      shareReplay(CACHE_SIZE)
    )

    const resetEvents$ = this.resetCacheRequests$.pipe(toCacheEvent(CacheEventType.Reset))
    const requestEvents$ = this.requests$.pipe(toCacheEvent(CacheEventType.Request))
    const responseEvents$ = this.responses$.pipe(toCacheEvent(CacheEventType.Response))
    const cacheEvents$ = merge(resetEvents$, requestEvents$, responseEvents$).pipe(
      startWith({ type: CacheEventType.Initial, timestamp: INITIAL_TIME })
    )

    this.cacheState$ = cacheEvents$.pipe(
      scan<CacheEvent, CacheState>(
        (cacheState, cacheEvent) => {
          const lastRequestTimestamp =
            cacheEvent.type === CacheEventType.Request
              ? cacheEvent.timestamp
              : cacheState.lastRequestTimestamp
          const lastResponseTimestamp =
            cacheEvent.type === CacheEventType.Response
              ? cacheEvent.timestamp
              : cacheState.lastResponseTimestamp
          return {
            lastRequestTimestamp,
            lastResponseTimestamp,
            lastEvent: cacheEvent.type,
            lastEventTimestamp: cacheEvent.timestamp
          }
        },
        {
          lastEvent: CacheEventType.Initial,
          lastEventTimestamp: INITIAL_TIME,
          lastRequestTimestamp: INITIAL_TIME,
          lastResponseTimestamp: INITIAL_TIME
        }
      ),
      shareReplay(CACHE_SIZE)
    )
  }

  invalidateCache(): void {
    this.resetCacheRequests$.next()
  }

  get(ifNotOlderThan: number = 0, returnExpiredCached: boolean = false): Observable<T> {
    return this.cacheState$.pipe(
      take(1),
      timestamp(),
      flatMap(({ value: cacheState, timestamp }) => {
        if (shouldMakeRequest(cacheState, timestamp, ifNotOlderThan)) {
          this.requests$.next()
          if (cacheState.lastResponseTimestamp !== INITIAL_TIME && !returnExpiredCached) {
            return this.responses$.pipe(skip(1))
          }
        }
        return this.responses$
      })
    )
  }
}
