"""Small in-memory TTL cache (per serverless instance; nothing is persisted)."""

import threading
import time
from collections import OrderedDict

_MISSING = object()


class TTLCache:
    def __init__(self, ttl_s: float, max_items: int = 512, clock=time.monotonic):
        self.ttl_s = ttl_s
        self.max_items = max_items
        self._clock = clock
        self._data: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key, default=None):
        with self._lock:
            item = self._data.get(key, _MISSING)
            if item is _MISSING:
                return default
            expires_at, value = item
            if self._clock() >= expires_at:
                del self._data[key]
                return default
            self._data.move_to_end(key)
            return value

    def set(self, key, value) -> None:
        with self._lock:
            self._data[key] = (self._clock() + self.ttl_s, value)
            self._data.move_to_end(key)
            while len(self._data) > self.max_items:
                self._data.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
