const { heroui } = require("@heroui/react");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#071637",
        action: "#245cff",
        "action-soft": "#edf4ff"
      },
      fontFamily: {
        sans: [
          "Microsoft YaHei",
          "PingFang SC",
          "Hiragino Sans GB",
          "Arial",
          "sans-serif"
        ]
      }
    }
  },
  darkMode: "class",
  plugins: [
    heroui({
      themes: {
        light: {
          colors: {
            primary: {
              DEFAULT: "#245cff",
              foreground: "#ffffff"
            }
          }
        }
      }
    })
  ]
};
