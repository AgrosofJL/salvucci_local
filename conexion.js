const { createClient } = require('@supabase/supabase-js');
// ACA ES LO NUEVO: Importamos la librería de WebSockets para Node
const WebSocket = require('ws');

// Configuración de Supabase
const SUPABASE_URL = "https://mvipxeeqfcxsuvwfyetb.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12aXB4ZWVxZmN4c3V2d2Z5ZXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MTMxNTYsImV4cCI6MjA5NDA4OTE1Nn0.EIRa9jEarmqt9rbydbeJWrJYZt842NyJei9MWj8n9mw";

/* =======================================================================
   ESTO LO MODIFIQUE: Le pasamos 'WebSocket' en las opciones de Realtime
   ======================================================================= */
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: {
    transport: WebSocket,
  },
});

console.log("Conexión SALVUCCI (Backend/Node) lista.");

module.exports = { supabase };