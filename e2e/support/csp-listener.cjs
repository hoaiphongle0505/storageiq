// Test-only frame preload, registered by capture-console.cjs. It runs before any page script,
// so CSP violations during the very first load are reported as console errors.
document.addEventListener('securitypolicyviolation', (event) => {
  console.error(`[csp] ${event.violatedDirective} ${event.blockedURI}`)
})
console.info('[e2e] securitypolicyviolation listener attached')
