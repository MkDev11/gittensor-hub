'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

export function useStorageValue<T>(
  key: string,
  parser: (raw: string | null) => T,
  serializer: (value: T) => string,
  defaultValue: T,
  eventName?: string,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(defaultValue);
  const parserRef = useRef(parser);
  const serializerRef = useRef(serializer);
  const defaultRef = useRef(defaultValue);
  parserRef.current = parser;
  serializerRef.current = serializer;
  defaultRef.current = defaultValue;

  useEffect(() => {
    const read = (): T => {
      if (typeof window === 'undefined') return defaultRef.current;
      try {
        return parserRef.current(localStorage.getItem(key));
      } catch {
        return defaultRef.current;
      }
    };
    setValue(read());
    const handler = () => setValue(read());
    if (eventName) window.addEventListener(eventName, handler);
    window.addEventListener('storage', handler);
    return () => {
      if (eventName) window.removeEventListener(eventName, handler);
      window.removeEventListener('storage', handler);
    };
  }, [key, eventName]);

  const write = useCallback(
    (next: T) => {
      if (typeof window === 'undefined') return;
      localStorage.setItem(key, serializerRef.current(next));
      // Local fallback for the no-eventName case (the native `storage` event
      // doesn't fire same-tab). When eventName is set, the dispatched event's
      // synchronous handler will overwrite this with the parsed disk value —
      // matching the original "state = parse(serialize(x))" semantics.
      setValue(next);
      if (eventName) window.dispatchEvent(new Event(eventName));
    },
    [key, eventName],
  );

  return [value, write];
}
