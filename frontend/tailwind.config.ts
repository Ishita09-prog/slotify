import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1440px" } },
    extend: {
      fontFamily: {
        sans: ['"Public Sans Variable"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ['"Archivo Variable"', '"Public Sans Variable"', "system-ui", "sans-serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        status: {
          available: "hsl(var(--status-available))",
          reserved: "hsl(var(--status-reserved))",
          occupied: "hsl(var(--status-occupied))",
          selected: "hsl(var(--status-selected))",
          maintenance: "hsl(var(--status-maintenance))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
      },
      keyframes: {
        "pulse-dot": { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } },
        "lane-flow": { from: { backgroundPosition: "0 0" }, to: { backgroundPosition: "48px 0" } },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        "lane-flow": "lane-flow 2.4s linear infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;
