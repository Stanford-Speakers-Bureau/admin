"use client";

import { createContext, useContext, useState } from "react";

export type EventOption = {
  id: string;
  name: string | null;
  start_time_date: string | null;
  standbyEnabled: boolean;
};

type EventContextType = {
  events: EventOption[];
  selectedEventId: string;
  setSelectedEventId: (id: string) => void;
  updateEvent: (id: string, updates: Partial<EventOption>) => void;
};

const EventContext = createContext<EventContextType | null>(null);

export function EventProvider({
  events: initialEvents,
  defaultEventId,
  children,
}: {
  events: EventOption[];
  defaultEventId: string;
  children: React.ReactNode;
}) {
  const [events, setEvents] = useState<EventOption[]>(initialEvents);
  const [selectedEventId, setSelectedEventId] = useState(defaultEventId);

  function updateEvent(id: string, updates: Partial<EventOption>) {
    setEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    );
  }

  return (
    <EventContext.Provider
      value={{ events, selectedEventId, setSelectedEventId, updateEvent }}
    >
      {children}
    </EventContext.Provider>
  );
}

export function useEventContext() {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error("useEventContext must be used within EventProvider");
  return ctx;
}
