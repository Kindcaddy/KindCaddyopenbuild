/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async headers() {
    // Only apply strict security headers in production
    // In development, use relaxed headers for Safari compatibility
    const isProduction = process.env.NODE_ENV === 'production';
    
    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: [
          // Content Security Policy (CSP)
          // Prevents XSS attacks by controlling which resources can be loaded
          {
            key: 'Content-Security-Policy',
            value: isProduction
              ? [
                  "default-src 'self'",
                  // Scripts: Allow self, unsafe-eval for Next.js dev mode, unsafe-inline for inline scripts
                  // Google Analytics: Allow GA4 and Google Tag Manager scripts
                  // Note: In production, consider removing 'unsafe-eval' if possible
                  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com",
                  // Styles: Allow self and unsafe-inline (needed for Tailwind CSS and Next.js)
                  "style-src 'self' 'unsafe-inline'",
                  // Images: Allow self, data URIs, and HTTPS images
                  "img-src 'self' data: https:",
                  // Fonts: Allow self and data URIs
                  "font-src 'self' data:",
                  // API connections: same origin + analytics only. All AI /
                  // email / integration traffic is server-side, so the
                  // browser never needs localhost, SendGrid, or provider
                  // origins here (PRODUCTION-PLAN.md Phase 3.3).
                  "connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com",
                  // Prevent embedding in iframes (clickjacking protection)
                  "frame-ancestors 'none'",
                  // Base URI: Only allow same origin
                  "base-uri 'self'",
                  // Form actions: Only allow same origin
                  "form-action 'self'",
                  // Upgrade insecure requests to HTTPS
                  "upgrade-insecure-requests",
                ].join('; ')
              : [
                  // Development: Relaxed CSP for Safari compatibility
                  "default-src 'self'",
                  "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:*",
                  "style-src 'self' 'unsafe-inline' http://localhost:*",
                  "img-src 'self' data: http: https:",
                  "font-src 'self' data: http: https:",
                  "connect-src 'self' http://localhost:* ws://localhost:* ws://*:*",
                  "frame-ancestors 'none'",
                  "base-uri 'self'",
                  "form-action 'self'",
                  // Note: Removed 'upgrade-insecure-requests' for development to allow HTTP on localhost
                ].join('; '),
          },
          // Strict Transport Security (HSTS)
          // Forces browsers to use HTTPS only for 1 year
          // Only apply in production (Safari blocks HTTP on localhost with HSTS)
          ...(isProduction
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains; preload',
                },
              ]
            : []),
          // X-Frame-Options
          // Prevents clickjacking by blocking iframe embedding
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // X-Content-Type-Options
          // Prevents MIME type sniffing attacks
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Referrer-Policy
          // Controls how much referrer information is sent with requests
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Permissions-Policy (formerly Feature-Policy)
          // Controls which browser features and APIs can be used
          {
            key: 'Permissions-Policy',
            value: [
              'geolocation=()',
              'microphone=()',
              'camera=()',
              'payment=()',
              'usb=()',
              'magnetometer=()',
              'gyroscope=()',
              'accelerometer=()',
            ].join(', '),
          },
          // X-XSS-Protection (legacy, but helps older browsers)
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          // X-DNS-Prefetch-Control
          // Controls DNS prefetching for performance
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          // Cross-Origin Opener Policy (COOP)
          // Isolates browsing context to prevent cross-origin attacks
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
