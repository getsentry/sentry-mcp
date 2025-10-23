import type { Config } from "tailwindcss";

export default {
  content: ["./client/**/*.{html,ts,tsx}", "./index.html"],
  darkMode: ["class"],
  theme: {
    extend: {},
  },
  plugins: [require("@tailwindcss/typography")],
} satisfies Config;
