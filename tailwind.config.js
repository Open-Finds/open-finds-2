/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' },
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        /* shadcn/ui token contract */
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        /* Amber: the one filled primary action per view, and selected state */
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          hover: 'hsl(var(--primary-hover) / <alpha-value>)',
          active: 'hsl(var(--primary-active) / <alpha-value>)',
          text: 'hsl(var(--primary-text) / <alpha-value>)',
          soft: {
            DEFAULT: 'hsl(var(--primary-soft) / <alpha-value>)',
            foreground: 'hsl(var(--primary-soft-foreground) / <alpha-value>)',
          },
        },
        /* Violet: AI actions and AI results only */
        ai: {
          DEFAULT: 'hsl(var(--ai) / <alpha-value>)',
          foreground: 'hsl(var(--ai-foreground) / <alpha-value>)',
          soft: {
            DEFAULT: 'hsl(var(--ai-soft) / <alpha-value>)',
            foreground: 'hsl(var(--ai-soft-foreground) / <alpha-value>)',
          },
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
          text: 'hsl(var(--destructive-text) / <alpha-value>)',
          soft: 'hsl(var(--destructive-soft) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          soft: 'hsl(var(--success-soft) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          soft: 'hsl(var(--warning-soft) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
          soft: 'hsl(var(--info-soft) / <alpha-value>)',
        },
        scrim: 'hsl(var(--scrim) / <alpha-value>)',
        /* The logo's yellow (Robert: add-tag and new-collection buttons). */
        'brand-yellow': 'hsl(var(--brand-yellow) / <alpha-value>)',
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },

      },
      fontFamily: {
        sans: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      /* 10 / 12 / 16px: tabs inside a control, controls, cards */
      borderRadius: {
        lg: '1rem',
        md: '0.75rem',
        sm: '0.625rem',
      },
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
      },
      /* The only two gradients: the logo's orbit, and the primary button's body */
      backgroundImage: {
        'brand-ring': 'var(--brand-ring-gradient)',
        'primary-gradient': 'var(--primary-gradient)',
        'primary-gradient-hover': 'var(--primary-gradient-hover)',
        'primary-gradient-active': 'var(--primary-gradient-active)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'bounce-arrow': {
          '0%, 100%': { transform: 'translateY(0)', opacity: '0.6' },
          '50%': { transform: 'translateY(10px)', opacity: '1' },
        },
        'slide-left': {
          '0%': { opacity: '0', transform: 'translateX(-30px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-right': {
          '0%': { opacity: '0', transform: 'translateX(30px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
        'bounce-arrow': 'bounce-arrow 1.8s ease-in-out infinite',
        'slide-left': 'slide-left 0.3s ease-out',
        'slide-right': 'slide-right 0.3s ease-out',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    /* Named type roles. Caption is the only uppercase one; nothing is under 12px. */
    function ({ addUtilities }) {
      addUtilities({
        '.text-display': { fontSize: '1.875rem', lineHeight: '2.25rem', fontWeight: '800', letterSpacing: '-0.03em' },
        '.text-title': { fontSize: '1.5rem', lineHeight: '1.875rem', fontWeight: '700', letterSpacing: '-0.02em' },
        '.text-heading': { fontSize: '1.125rem', lineHeight: '1.625rem', fontWeight: '600', letterSpacing: '-0.01em' },
        '.text-subheading': { fontSize: '1rem', lineHeight: '1.5rem', fontWeight: '600' },
        '.text-body': { fontSize: '1rem', lineHeight: '1.5rem', fontWeight: '400' },
        '.text-small': { fontSize: '0.875rem', lineHeight: '1.25rem', fontWeight: '500' },
        '.text-label': { fontSize: '0.9375rem', lineHeight: '1.25rem', fontWeight: '600' },
        '.text-caption': { fontSize: '0.75rem', lineHeight: '1rem', fontWeight: '600', letterSpacing: '0.04em', textTransform: 'uppercase' },
        '@media (min-width: 48rem)': {
          '.text-display': { fontSize: '2.5rem', lineHeight: '2.875rem' },
          '.text-title': { fontSize: '1.75rem', lineHeight: '2.125rem' },
          '.text-heading': { fontSize: '1.25rem', lineHeight: '1.75rem' },
          '.text-body': { fontSize: '0.9375rem', lineHeight: '1.375rem' },
        },
      });
    },
  ],
};
