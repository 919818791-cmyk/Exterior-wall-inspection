import { forwardRef, type InputHTMLAttributes } from "react";

export const PhoneInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PhoneInput({ className, ...inputProps }, ref) {
    return (
      <div className="auth-phone-input">
        <span aria-hidden="true" className="auth-phone-prefix">+86</span>
        <input {...inputProps} ref={ref} className={className} />
      </div>
    );
  }
);
