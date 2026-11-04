import { Eye, EyeOff } from "lucide-react";
import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes
} from "react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  errorMessage?: string;
  floatingLabel?: boolean;
  label: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ errorMessage = "", floatingLabel = false, id, label, ...props }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const errorId = `${inputId}-error`;
    const [isVisible, setIsVisible] = useState(false);

    return (
      <label className={`auth-field${floatingLabel ? " floating-line-field" : ""}`} htmlFor={inputId}>
        {!floatingLabel ? <span>{label}</span> : null}
        <div className="auth-secret-control">
          <input
            {...props}
            ref={ref}
            aria-describedby={props["aria-describedby"] ?? (errorMessage ? errorId : undefined)}
            aria-invalid={props["aria-invalid"] ?? (errorMessage ? true : undefined)}
            aria-label={props["aria-label"] ?? (floatingLabel ? label : undefined)}
            id={inputId}
            type={isVisible ? "text" : "password"}
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
        {floatingLabel ? <span>{label}</span> : null}
        {floatingLabel && errorMessage ? <small className="floating-line-field-error" id={errorId}>{errorMessage}</small> : null}
      </label>
    );
  }
);
