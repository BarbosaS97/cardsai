const SUPABASE_URL = 'https://gxkhmmbovlfulcxyupue.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd4a2htbWJvdmxmdWxjeHl1cHVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNDAzMzcsImV4cCI6MjA5NTcxNjMzN30.BipAmuzpW_x7KhIQdgdnQma5wLOS53QVLFCMYsxmMqE';
const EDGE_URL = `${SUPABASE_URL}/functions/v1/process-pdf`;
const SUBJECT_URL = `${SUPABASE_URL}/functions/v1/generate-subject`;
const VALIDATE_COUPON_URL = `${SUPABASE_URL}/functions/v1/validate-coupon`;
const VERIFY_TURNSTILE_URL = `${SUPABASE_URL}/functions/v1/verify-turnstile`;
const STRIPE_CHECKOUT_URL = `${SUPABASE_URL}/functions/v1/stripe-checkout`;
const PIX_CHECKOUT_URL = `${SUPABASE_URL}/functions/v1/pix-checkout`;
const PIX_STATUS_URL = `${SUPABASE_URL}/functions/v1/pix-status`;

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseClient = db;

// Lock mobile zoom — prevents spontaneous scale increase after page load
if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
  const _vp = document.querySelector('meta[name="viewport"]');
  const _vpContent = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
  if (_vp) _vp.setAttribute('content', _vpContent);

  function _lockZoom() {
    if (!_vp) return;
    // Toggle trick: brief remove of maximum-scale forces iOS to re-evaluate at scale=1
    _vp.setAttribute('content', 'width=device-width, initial-scale=1.0');
    requestAnimationFrame(() => _vp.setAttribute('content', _vpContent));
  }

  // Primary: visualViewport.scale fires when iOS zooms in/out (innerWidth alone doesn't catch this)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (window.visualViewport.scale > 1.05) _lockZoom();
    });
  }

  // Fallback: orientation or layout-viewport changes
  let _lastW = window.innerWidth;
  setInterval(() => {
    if (window.innerWidth !== _lastW) {
      _lockZoom();
      _lastW = window.innerWidth;
    }
  }, 200);
}
