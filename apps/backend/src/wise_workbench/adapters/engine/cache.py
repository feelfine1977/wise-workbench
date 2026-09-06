"""A small thread-safe LRU cache for live library objects (score results, logs, frames)."""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable, Hashable
from typing import Generic, TypeVar

T = TypeVar("T")


class LRUCache(Generic[T]):
    def __init__(self, capacity: int):
        self.capacity = max(int(capacity), 0)
        self._items: OrderedDict[Hashable, T] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Hashable) -> T | None:
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def put(self, key: Hashable, value: T) -> T:
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self.capacity:
                self._items.popitem(last=False)
        return value

    def get_or_compute(self, key: Hashable, compute: Callable[[], T]) -> T:
        hit = self.get(key)
        if hit is not None:
            return hit
        return self.put(key, compute())

    def invalidate(self, key: Hashable) -> None:
        with self._lock:
            self._items.pop(key, None)

    def __contains__(self, key: Hashable) -> bool:
        with self._lock:
            return key in self._items

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)
