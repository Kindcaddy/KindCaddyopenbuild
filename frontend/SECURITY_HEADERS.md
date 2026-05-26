# Security Headers Configuration

This document explains the security headers configured in `next.config.js` and how to customize them.

## Configured Headers

### 1. Content-Security-Policy (CSP)
**Purpose**: Prevents XSS attacks by controlling which resources can be loaded.

**Current Configuration**:
- `default-src 'self'` - Only allow resources from same origin by default
- `script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com` - Allow scripts from self (needed for Next.js) and Google Analytics
- `style-src 'self' 'unsafe-inline'` - Allow styles from self (needed for Tailwind CSS)
- `img-src 'self' data: https:` - Allow images from self, data URIs, and HTTPS
- `font-src 'self' data:` - Allow fonts from self and data URIs
- `connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com https://www.google.com https://api.sendgrid.com http://localhost:* ws://localhost:*` - Allow API calls to same origin, Google Analytics, SendGrid email service, and local AI API (development)
- `frame-ancestors 'none'` - Prevent embedding in iframes
- `upgrade-insecure-requests` - Automatically upgrade HTTP to HTTPS

**Configured External Services**:
- **Google Analytics**: GA4 and Google Tag Manager domains for tracking scripts and API calls
- **SendGrid**: Email service API for transactional emails
- **Local AI API**: Localhost connections for development (supports any port via `localhost:*`)

**Note**: To add additional external APIs, add them to `connect-src`:
```javascript
"connect-src 'self' https://api.example.com"
```

### 2. Strict-Transport-Security (HSTS)
**Purpose**: Forces browsers to use HTTPS only.

**Current Configuration**: `max-age=31536000; includeSubDomains; preload`
- Valid for 1 year
- Applies to all subdomains
- Eligible for browser preload lists

### 3. X-Frame-Options
**Purpose**: Prevents clickjacking attacks.

**Current Configuration**: `DENY` - Completely blocks iframe embedding

**Alternatives**:
- `SAMEORIGIN` - Allow embedding only from same origin
- `ALLOW-FROM uri` - Allow embedding from specific URI (deprecated)

### 4. X-Content-Type-Options
**Purpose**: Prevents MIME type sniffing attacks.

**Current Configuration**: `nosniff` - Browsers must respect declared content types

### 5. Referrer-Policy
**Purpose**: Controls how much referrer information is sent.

**Current Configuration**: `strict-origin-when-cross-origin`
- Same-origin: Full referrer
- Cross-origin HTTPS: Origin only
- Cross-origin HTTP: No referrer

**Other Options**:
- `no-referrer` - Never send referrer
- `origin` - Send origin only
- `same-origin` - Send referrer only for same-origin requests

### 6. Permissions-Policy
**Purpose**: Controls which browser features can be used.

**Current Configuration**: All features disabled by default
- `geolocation=()` - No geolocation access
- `microphone=()` - No microphone access
- `camera=()` - No camera access
- `payment=()` - No payment API access

**To Enable Features**:
```javascript
'geolocation=(self "https://example.com")' // Allow for self and example.com
```

### 7. X-XSS-Protection
**Purpose**: Enables browser's built-in XSS filter (legacy support).

**Current Configuration**: `1; mode=block` - Enable and block page if XSS detected

### 8. X-DNS-Prefetch-Control
**Purpose**: Controls DNS prefetching for performance.

**Current Configuration**: `on` - Enable DNS prefetching

### 9. Cross-Origin-Opener-Policy (COOP)
**Purpose**: Isolates browsing context to prevent cross-origin attacks.

**Current Configuration**: `same-origin` - Only same-origin windows can access this window

## Testing Your Security Headers

### 1. Browser DevTools
1. Open your app in the browser
2. Open DevTools (F12)
3. Go to Network tab
4. Reload the page
5. Click on any request
6. Check the Response Headers section

### 2. Online Tools
- **SecurityHeaders.com**: https://securityheaders.com
- **Mozilla Observatory**: https://observatory.mozilla.org
- **CSP Evaluator**: https://csp-evaluator.withgoogle.com

### 3. Command Line
```bash
curl -I https://your-domain.com
```

## Configured External Services

### Google Analytics
**Domains Added**:
- `https://www.google-analytics.com` - GA4 tracking scripts and API calls
- `https://www.googletagmanager.com` - Google Tag Manager scripts
- `https://www.google.com` - Additional Google services

**CSP Directives**:
- `script-src`: Allows loading GA scripts
- `connect-src`: Allows tracking API calls

### Email Service (SendGrid)
**Domain Added**: `https://api.sendgrid.com`

**CSP Directive**: `connect-src` - Allows email API calls from frontend

**Switching Email Providers**:
If you need to switch to a different email service, update `connect-src`:
- **Resend**: `https://api.resend.com`
- **Mailgun**: `https://api.mailgun.net`
- **AWS SES**: `https://email.*.amazonaws.com` (use specific region in production)

### Local AI API
**Development Configuration**:
- `http://localhost:*` - HTTP connections to local AI API (any port)
- `ws://localhost:*` - WebSocket connections for real-time AI responses

**Production Configuration**:
- If using Next.js API routes (`/api/*`): Same origin, no changes needed
- If using separate server: Add specific domain to `connect-src`:
  ```javascript
  "connect-src 'self' https://ai-api.yourdomain.com"
  ```

**Security Note**: Localhost wildcards (`localhost:*`) are only safe in development. In production, use specific domains or same-origin.

## Customization Guide

### Adding External Domains

If you need to load resources from external domains, update the CSP:

**Example: Adding Google Fonts**
```javascript
"font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com"
```

**Example: Adding External API**
```javascript
"connect-src 'self' https://api.example.com https://api.another-service.com"
```

**Example: Adding CDN for Images**
```javascript
"img-src 'self' data: https: https://cdn.example.com"
```

### Production Considerations

1. **Remove 'unsafe-eval'**: In production, try to remove `'unsafe-eval'` from `script-src` if possible
2. **Stricter CSP**: Consider using nonces or hashes for inline scripts/styles
3. **Environment-Specific**: You can make headers conditional based on environment:

```javascript
const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = isProduction 
  ? [/* stricter production headers */]
  : [/* development headers */];
```

## Common Issues and Solutions

### Issue: Styles not loading
**Solution**: Ensure `'unsafe-inline'` is in `style-src` (needed for Tailwind CSS)

### Issue: External API calls blocked
**Solution**: Add API domain to `connect-src`:
```javascript
"connect-src 'self' https://your-api-domain.com"
```

### Issue: Google Analytics not tracking
**Solution**: Verify domains are in both `script-src` and `connect-src`. Check browser console for CSP violations.

### Issue: Email API calls blocked
**Solution**: Ensure SendGrid domain (`https://api.sendgrid.com`) is in `connect-src`. If using a different provider, add their domain.

### Issue: Local AI API not connecting
**Solution**: 
- Development: Ensure `http://localhost:*` and `ws://localhost:*` are in `connect-src`
- Production: Add your AI API domain to `connect-src` or use Next.js API routes for same-origin

### Issue: Images from CDN not loading
**Solution**: Add CDN domain to `img-src`:
```javascript
"img-src 'self' data: https: https://your-cdn.com"
```

### Issue: Third-party scripts not working
**Solution**: Add script source to `script-src`:
```javascript
"script-src 'self' 'unsafe-eval' 'unsafe-inline' https://trusted-script.com"
```

## Security Best Practices

1. **Start Strict, Loosen Gradually**: Begin with strict CSP and add exceptions only when needed
2. **Regular Audits**: Test your headers regularly using security scanners
3. **Monitor CSP Reports**: Set up CSP reporting to catch violations
4. **Keep Updated**: Review and update headers as your app evolves
5. **Document Changes**: Keep track of why certain exceptions were added

## Additional Resources

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [OWASP: Secure Headers](https://owasp.org/www-project-secure-headers/)
- [Next.js: Headers](https://nextjs.org/docs/app/api-reference/next-config-js/headers)
- [SecurityHeaders.com](https://securityheaders.com)
