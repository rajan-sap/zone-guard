/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        danger: "#ef4444",
        warning: "#f59e0b",
        safe: "#22c55e",
      },
    },
  },
  plugins: [],
};
