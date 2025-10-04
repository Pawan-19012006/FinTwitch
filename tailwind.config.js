/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        gta: ["Audiowide", "cursive"], // ✨ GTA-inspired font
      },
      colors: {
        neonPink: "#ff2e97",
        neonCyan: "#00ffff",
        neonPurple: "#9b5de5",
        neonYellow: "#f9f871",
      },
      boxShadow: {
        neon: "0 0 20px rgba(255, 255, 255, 0.4)",
      },
    },
  },
  plugins: [],
};