import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

// A reusable, on-brand replacement for the native window.confirm / alert /
// prompt dialogs. Mount <ModalProvider> once near the root, then call the
// promise-based helpers from useModal() anywhere:
//
//   const modal = useModal();
//   if (!(await modal.confirm("Supprimer ?"))) return;
//   const name = await modal.prompt({ title: "Nom ?", defaultValue: "" });
//
// Styling reuses the existing .modal-* classes (see styles.css) so every popup
// matches the rest of the UI.

type Kind = "confirm" | "alert" | "prompt";

type DialogSpec = {
  kind: Kind;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  // prompt only
  defaultValue?: string;
  placeholder?: string;
};

// Callers may pass a bare string (the message) or a full options object.
type Arg = string | Omit<DialogSpec, "kind">;

type ModalApi = {
  confirm: (arg: Arg) => Promise<boolean>;
  alert: (arg: Arg) => Promise<void>;
  prompt: (arg: Arg) => Promise<string | null>;
};

const ModalContext = createContext<ModalApi | null>(null);

export function useModal(): ModalApi {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within a <ModalProvider>");
  return ctx;
}

function normalize(arg: Arg): Omit<DialogSpec, "kind"> {
  return typeof arg === "string" ? { message: arg } : arg;
}

type Active = DialogSpec & { resolve: (value: unknown) => void };

export function ModalProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Active | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const open = useCallback((spec: DialogSpec) => {
    return new Promise<unknown>((resolve) => {
      setValue(spec.defaultValue ?? "");
      setActive({ ...spec, resolve });
    });
  }, []);

  const api = useRef<ModalApi>({
    confirm: (arg) => open({ kind: "confirm", ...normalize(arg) }) as Promise<boolean>,
    alert: (arg) => open({ kind: "alert", ...normalize(arg) }) as Promise<void>,
    prompt: (arg) => open({ kind: "prompt", ...normalize(arg) }) as Promise<string | null>,
  }).current;

  // Cancel = false (confirm) / null (prompt) / undefined (alert).
  const cancel = useCallback(() => {
    setActive((a) => {
      if (!a) return null;
      a.resolve(a.kind === "prompt" ? null : a.kind === "confirm" ? false : undefined);
      return null;
    });
  }, []);

  const submit = useCallback(() => {
    setActive((a) => {
      if (!a) return null;
      a.resolve(a.kind === "prompt" ? value : a.kind === "confirm" ? true : undefined);
      return null;
    });
  }, [value]);

  // Focus the input (prompt) or the confirm button when a dialog opens.
  useEffect(() => {
    if (!active) return;
    if (active.kind === "prompt") inputRef.current?.select();
  }, [active]);

  return (
    <ModalContext.Provider value={api}>
      {children}
      {active && (
        <div className="modal-backdrop" onClick={cancel}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
              else if (e.key === "Enter" && active.kind !== "prompt") submit();
            }}
          >
            {active.title && <h3 className="modal-title">{active.title}</h3>}
            {active.message && <p className="modal-message">{active.message}</p>}

            {active.kind === "prompt" && (
              <input
                ref={inputRef}
                className="modal-input"
                value={value}
                autoFocus
                placeholder={active.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            )}

            <div className="modal-actions">
              {active.kind !== "alert" && (
                <button className="link" onClick={cancel}>
                  {active.cancelLabel ?? "Annuler"}
                </button>
              )}
              <button
                className={`btn sm${active.danger ? " danger" : ""}`}
                autoFocus={active.kind !== "prompt"}
                onClick={submit}
              >
                {active.confirmLabel ??
                  (active.kind === "alert" ? "OK" : "Confirmer")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}
