import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { TimestampedInput } from "@daily-speedruns/shared";

export type SessionStatus =
  | "IDLE"
  | "PLAYING"
  | "WON"
  | "LOST"
  | "CRASHED"
  | "SUBMITTING";

export interface RunResult {
  verified: boolean;
  rank?: number | null;
  error?: string;
}

interface UseGameSessionOptions<TAction> {
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<TAction>[]
  ) => Promise<RunResult>;
  /** Fired once when the run is submitted (confetti, sound, etc.). */
  onWin?: () => void;
  winMessage?: string;
}

export interface GameSession<TAction> {
  status: SessionStatus;
  statusRef: MutableRefObject<SessionStatus>;
  elapsedMs: number;
  resultMessage: string;
  rank: number | null;
  begin: () => number;
  now: () => number;
  record: (action: TAction, t: number, tick?: number) => void;
  submit: (claimedTimeMs: number) => void;
  fail: (message: string, status?: "LOST" | "CRASHED") => void;
  reset: () => void;
}

/**
 * Shared speedrun session state: stopwatch, status, action log, submission and
 * result handling. Keeps status in a ref so event handlers never read a stale
 * React value.
 */
export function useGameSession<TAction>(
  options: UseGameSessionOptions<TAction>
): GameSession<TAction> {
  const { onRunFinished, onWin, winMessage = "Run Verified!" } = options;

  const [status, setStatusState] = useState<SessionStatus>("IDLE");
  const statusRef = useRef<SessionStatus>("IDLE");
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [rank, setRank] = useState<number | null>(null);

  const startTimeRef = useRef<number>(0);
  const inputsRef = useRef<TimestampedInput<TAction>[]>([]);
  const onRunFinishedRef = useRef(onRunFinished);
  const onWinRef = useRef(onWin);
  onRunFinishedRef.current = onRunFinished;
  onWinRef.current = onWin;

  const setStatus = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const reset = useCallback(() => {
    setStatus("IDLE");
    setElapsedMs(0);
    setResultMessage("");
    setRank(null);
    startTimeRef.current = 0;
    inputsRef.current = [];
  }, [setStatus]);

  const now = useCallback(
    () => Math.max(0, Math.round(performance.now() - startTimeRef.current)),
    []
  );

  const begin = useCallback(() => {
    if (statusRef.current === "IDLE") {
      startTimeRef.current = performance.now();
      setStatus("PLAYING");
    }
    return now();
  }, [now, setStatus]);

  const record = useCallback((action: TAction, t: number, tick?: number) => {
    inputsRef.current.push({
      t: Math.max(0, Math.round(t)),
      ...(tick !== undefined ? { tick } : {}),
      action,
    });
  }, []);

  const submit = useCallback(
    (claimedTimeMs: number) => {
      if (statusRef.current === "WON" || statusRef.current === "SUBMITTING") {
        return;
      }

      setStatus("SUBMITTING");
      setElapsedMs(claimedTimeMs);
      onWinRef.current?.();

      onRunFinishedRef.current(claimedTimeMs, [...inputsRef.current])
        .then((res) => {
          if (res.verified) {
            setRank(res.rank ?? null);
            setResultMessage(
              res.rank
                ? `Verified! You claimed rank #${res.rank}!`
                : winMessage
            );
            setStatus("WON");
          } else {
            setResultMessage(res.error || "Verification rejected");
            setStatus("LOST");
          }
        })
        .catch((err: unknown) => {
          setResultMessage(
            err instanceof Error ? err.message : "Network error"
          );
          setStatus("LOST");
        });
    },
    [setStatus, winMessage]
  );

  const fail = useCallback(
    (message: string, nextStatus: "LOST" | "CRASHED" = "LOST") => {
      setResultMessage(message);
      setStatus(nextStatus);
    },
    [setStatus]
  );

  // Live stopwatch loop (60fps) while playing.
  useEffect(() => {
    if (status !== "PLAYING") return;

    let frame: number;
    const update = () => {
      if (statusRef.current === "PLAYING") {
        setElapsedMs(now());
        frame = requestAnimationFrame(update);
      }
    };

    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [status, now]);

  return {
    status,
    statusRef,
    elapsedMs,
    resultMessage,
    rank,
    begin,
    now,
    record,
    submit,
    fail,
    reset,
  };
}
