"use client";

import { useEffect, useState } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";

const CONTEXTS = {
  signin: {
    label: "Signing you in",
    orb: "connecting",
    messages: ["Checking the guest list…", "Finding your name tag…", "Holding the door for you…", "Almost through the door…"],
  },
  discover: {
    label: "Loading open Rallies",
    orb: "searching",
    messages: ["Walking the venue…", "Seeing what's on…", "Peeking into the food court…", "Spotting open Rallies…"],
  },
  inbox: {
    label: "Loading your inbox",
    orb: "working",
    messages: ["Checking your invites…", "Opening your mail…", "Looking for your name…", "Sorting the good news…"],
  },
  match: {
    label: "Loading your match",
    orb: "connecting",
    messages: ["Checking who's in…", "Comparing notes…", "Finding common ground…", "Doing the introductions…"],
  },
  rally: {
    label: "Loading your Rally",
    orb: "weaving",
    messages: ["Checking on your Rally…", "Counting heads…", "Looking around the room…", "Picking up where you left off…"],
  },
  room: {
    label: "Loading your room",
    orb: "breathing",
    messages: ["Opening the room…", "Turning the lights on…", "Pulling up chairs…", "Saying hi to everyone…"],
  },
  photos: {
    label: "Loading photo status",
    orb: "shaping",
    messages: ["Flipping through the album…", "Looking for your group photo…", "Checking who's in frame…"],
  },
  questions: {
    label: "Choosing your questions",
    orb: "composing",
    messages: ["Reading your interests…", "Thinking about what to ask you…", "Skipping the boring questions…", "Picking the good ones…"],
  },
} satisfies Record<string, { label: string; orb: OrbState; messages: string[] }>;

const MESSAGE_MS = 2400;

export default function RallyLoader({ context }: { context: keyof typeof CONTEXTS }) {
  const { label, orb, messages } = CONTEXTS[context];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % messages.length), MESSAGE_MS);
    return () => window.clearInterval(timer);
  }, [messages.length]);

  return (
    <div className="rally-loader-wrap">
      {/* Screen readers get one stable status; the rotating jokes would repeat every few seconds. */}
      <span role="status" className="rally-loader-sr">{label}</span>
      <div className="rally-loader" aria-hidden="true">
        <ThinkingOrb state={orb} size={20} color="#315FE8" theme="light" aria-hidden="true" />
        <span className="rally-loader-text">
          {/* Invisible copies hold the loader at its widest message so it doesn't jump. */}
          {messages.map((message) => (
            <span key={message} className="rally-loader-sizer">{message}</span>
          ))}
          <span key={index} className="rally-loader-message">{messages[index]}</span>
        </span>
      </div>
    </div>
  );
}
