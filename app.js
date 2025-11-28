// =======================================================
// CORRECCIÓN 1: IMPORTAR MÓDULO 'path'
// Esto resuelve el error "TypeError: path.join is not a function"
// =======================================================
const path = require('path');

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de la base de datos (usará DATABASE_URL de Render, que ahora debe ser la URL Pública de Railway)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
    secret: 'tu_clave_secreta_aqui', // Cambia esto en producción
    resave: false,
    saveUninitialized: true
}));

// Configuración para servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Establecer EJS como motor de plantillas
app.set('view engine', 'ejs');

// =======================================================
// RUTAS
// =======================================================

// Ruta principal para listar productos (CORREGIDA para pasar 'cart')
app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id');
        
        // CORRECCIÓN 2: Inicializa req.session.cart si no existe, y lo pasa a la vista.
        if (!req.session.cart) {
            req.session.cart = [];
        }

        res.render('index', { 
            products: result.rows,
            user: req.session.user,
            cart: req.session.cart // Pasa la variable 'cart' para que la navbar no falle.
        });
    } catch (err) {
        console.error('Error al obtener productos:', err);
        // Mostrar error interno si la conexión a la DB falla (ya no debería fallar si la URL es pública)
        res.status(500).send('Internal Server Error (Error al obtener productos)');
    }
});

// Ruta de login (simulación)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT id, username, email FROM users WHERE email = $1 AND password = $2', [email, password]);

        if (result.rows.length > 0) {
            req.session.user = result.rows[0];
            res.redirect('/');
        } else {
            res.redirect('/'); 
        }
    } catch (err) {
        console.error('Error en el login:', err);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta de logout
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error(err);
        }
        res.redirect('/');
    });
});

// Ruta para añadir un producto al carrito (simulación)
app.post('/add-to-cart/:id', async (req, res) => {
    const productId = req.params.id;
    if (!req.session.cart) {
        req.session.cart = [];
    }
    req.session.cart.push(productId);
    res.redirect('/');
});

// Ruta de carrito (simulación)
app.get('/cart', async (req, res) => {
    const cartIds = req.session.cart || [];
    let cartProducts = [];

    if (cartIds.length > 0) {
        const placeholders = cartIds.map((_, i) => `$${i + 1}`).join(',');
        
        try {
            const result = await pool.query(`SELECT * FROM products WHERE id IN (${placeholders})`, cartIds);
            cartProducts = result.rows;
        } catch (err) {
            console.error('Error al obtener el carrito:', err);
        }
    }
    
    res.render('cart', { 
        cart: cartProducts,
        user: req.session.user
    });
});


// =======================================================
// INICIO DEL SERVIDOR
// =======================================================
app.listen(port, () => {
    console.log(`Servidor Express corriendo en http://localhost:${port}`);
});