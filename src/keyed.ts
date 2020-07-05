import { Observable, Observer, Subject } from 'rxjs';
import { map, filter, multicast, refCount, startWith } from 'rxjs/operators';

import { State } from './state';
import { KeyFunc, ListChanges, Change, EqualityCheck } from './types';
import { Watcher } from './util/watcher';


export class KeyedState<T> extends Observable<T[] | undefined> implements Observer<T[] | undefined> {
  private _changes: Observable<[Change<T[]>, ListChanges<T>]>;
  private _changesub: Subject<[Change<T[]>, ListChanges<T>]>;
  private _watcher: Watcher<T>;
  private _traceKey: string;

  constructor(
    readonly state: State<T[]>,
    readonly keyfunc: KeyFunc<T>,
  ) {
    super((observer: Observer<T[] | undefined>) => {
      return this._changes.pipe(map(([change, _]) => change.value), startWith(this.value)).subscribe(observer);
    });

    this._traceKey = Math.random().toString(36).substring(2, 15)
                    + Math.random().toString(36).substring(2, 15);
    this._watcher = new Watcher(state.value, keyfunc);
    this._changesub = new Subject<[Change<T[]>, ListChanges<T>]>();
    this._changes = this.state.downstream.pipe(
      map(change => [change, this._watcher.changes(change.value)] as [Change<T[]>, ListChanges<T>]),
      multicast(() => this._changesub),
      refCount(),
    );
  }

  next(t: T[] | undefined) {
    this.state.upstream.next({ value: t, from: this.value, to: t });
  }

  error(err: any) { this.state.upstream.error(err); }
  complete() { this._changesub.complete(); }

  get value() { return this._watcher.last; }
  set value(t: T[]) { this.next(t); }

  key(key: number | string, isEqual: EqualityCheck<T> = (a, b) => a === b) {
    const sub: State<T> = new State(
      this._watcher.keymap[key]?.item,
      this.keyDownstream(key, v => !isEqual(v, sub.value)),
      this.keyUpstream(key),
    );

    return sub;
  }

  keyDownstream(key: number | string, hasChanged: (t: T) => boolean) {
    return this._changes.pipe(
      map(([change, _]) => ({ 
        trace: change.trace, from: change.from, to: change.to,
        entry: this._watcher.keymap[key],
      })),
      filter(change =>
        change.trace?.head?.keys?.[this._traceKey] === key
        || change.trace?.head?.sub === change.entry.index
        || (
          !change.trace?.head
          && hasChanged(change.entry.item)
        )
      ),
      map(change => ({
        value: change.entry.item,
        from: change.from, to: change.to,
        trace: change.trace?.rest
      }))
    );
  }

  keyUpstream(key: number | string): Observer<Change<T>> {
    return {
      next: change => {
        const entry = this._watcher.keymap[key];
        this._watcher.last[entry.index] = change.value!!;
        this.state.upstream.next({
          value: this._watcher.last,
          from: change.from, to: change.to,
          trace: {
            head: { sub: entry.index, keys: { [this._traceKey]: key }},
            rest: change.trace,
          }
        });
      },
      error: err => this.state.upstream.error(err),
      complete: () => {},
    }
  }

  index(key: number | string) {
    return this._changes.pipe(map(() => this._watcher.keymap[key].index));
  }

  changes() {
    return this._changes.pipe(map(([_, listChanges]) => listChanges));
  }
}
