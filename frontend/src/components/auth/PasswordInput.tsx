import { Eye, EyeOff } from "lucide-react";
import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ id, label, onKeyDown, onKeyUp, ...props }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const capsLockHintId = `${inputId}-caps-lock`;
    const [isVisible, setIsVisible] = useState(false);
    const [capsLockOn, setCapsLockOn] = useState(false);

    function updateCapsLock(event: ReactKeyboardEvent<HTMLInputElement>) {
      setCapsLockOn(event.getModifierState("CapsLock"));
    }

    return (
      <label className="auth-field" htmlFor={inputId}>
        <span>{label}</span>
        <div className="auth-secret-control">
          <input
            {...props}
            ref={ref}
            id={inputId}
            aria-describedby={capsLockOn ? capsLockHintId : props["aria-describedby"]}
            type={isVisible ? "text" : "password"}
            onKeyDown={(event) => {
              updateCapsLock(event);
              onKeyDown?.(event);
            }}
            onKeyUp={(event) => {
              updateCapsLock(event);
              onKeyUp?.(event);
            }}
          />
          <button
            aria-label={isVisible ? `隐藏${label}` : `显示${label}`}
            aria-pressed={isVisible}
            className="auth-secret-toggle"
            type="button"
            onClick={() => setIsVisible((visible) => !visible)}
          >
            {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
        {capsLockOn ? <small id={capsLockHintId} className="auth-caps-lock-hint">大写锁定已开启</small> : null}
      </label>
    );
  }
);
