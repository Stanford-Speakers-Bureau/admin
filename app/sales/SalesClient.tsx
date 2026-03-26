"use client";

import { useEventContext } from "@/app/EventContext";
import TicketSalesGraph from "@/app/events/TicketSalesGraph";

export default function SalesClient() {
  const { events, selectedEventId } = useEventContext();
  const currentEvent = events.find((e) => e.id === selectedEventId);

  return (
    <div className="px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white font-serif mb-2">
          Ticket Sales
        </h1>
        {currentEvent && (
          <p className="text-zinc-400">{currentEvent.name || "Unnamed Event"}</p>
        )}
      </div>

      {!selectedEventId ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-2xl border border-zinc-800">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <p className="text-zinc-400 text-lg mb-2">No event selected</p>
          <p className="text-zinc-600 text-sm">Select an event from the sidebar to view sales data</p>
        </div>
      ) : (
        <TicketSalesGraph eventId={selectedEventId} capacity={0} />
      )}
    </div>
  );
}
