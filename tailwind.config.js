/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        luxury: {
          50:  "#faf9f6",
          100: "#f4f2ec",
          200: "#e8e4d9",
          300: "#d4cebe",
          400: "#b5ab97",
          500: "#8a7e68",
          600: "#5c5240",
          700: "#3d3428",
          800: "#211c12",
          900: "#0e0b07",
          950: "#070503",
        },
        gold: {
          100: "#fef8e8",
          200: "#fcecbe",
          300: "#f8d97a",
          400: "#f0b429",
          500: "#c9911a",
          600: "#a67315",
          700: "#7d5410",
          800: "#523808",
          900: "#2e1f04",
        },
        navy: {
          700: "#0f0c1a",
          800: "#090614",
          900: "#040210",
        },
        // brand mapped to gold for backward-compat with existing component classes
        brand: {
          50:  "#fef8e8",
          100: "#fcecbe",
          500: "#f0b429",
          600: "#c9911a",
          700: "#a67315",
          900: "#0f0c1a",
        },
        accent: {
          400: "#f8d97a",
          500: "#f0b429",
        },
        dark: {
          800: "#1a1835",
          900: "#0f0c1a",
        },
      },
      fontFamily: {
        display: ["'Cormorant Garamond'", "Georgia", "serif"],
        body:    ["'Inter'", "system-ui", "sans-serif"],
        sans:    ["'Inter'", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "luxury-hero":    "linear-gradient(135deg, #0a0812 0%, #130f24 45%, #0a1020 100%)",
        "gold-gradient":  "linear-gradient(135deg, #c9911a 0%, #f0b429 50%, #c9911a 100%)",
        "gold-shimmer":   "linear-gradient(90deg, transparent, rgba(201,145,26,0.18), transparent)",
      },
      boxShadow: {
        luxury:     "0 4px 24px rgba(10,8,6,0.07), 0 1px 4px rgba(10,8,6,0.04)",
        "luxury-lg":"0 16px 56px rgba(10,8,6,0.11), 0 4px 16px rgba(10,8,6,0.06)",
        gold:       "0 4px 20px rgba(201,145,26,0.28)",
        "gold-lg":  "0 8px 40px rgba(201,145,26,0.38)",
      },
      animation: {
        "fade-up":      "fadeUp 0.6s ease-out forwards",
        "fade-in":      "fadeIn 0.4s ease-out forwards",
        "gold-shimmer": "goldShimmer 2.2s ease-in-out infinite",
        shimmer:        "shimmer 1.5s infinite",
      },
      keyframes: {
        fadeUp: {
          "0%":   { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        goldShimmer: {
          "0%,100%": { opacity: "0.6" },
          "50%":     { opacity: "1" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      transitionDuration: { 400: "400ms" },
    },
  },
  plugins: [],
};
