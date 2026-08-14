import { Eye, EyeOff } from "lucide-react";
import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes
} from "react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ id, label, ...props }, ref) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const [isVisible, setIsVisible] = useState(false);

    return (
      <label className="auth-field" htmlFor={inputId}>
        <span>{label}</span>
        <div className="auth-secret-control">
          <input
            {...props}
            ref={ref}
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
      </label>
    );
  }
);
