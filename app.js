// Agrega esta línea para importar el módulo 'path' y corregir el error:
const path = require('path');

// Resto de tus importaciones y configuración
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de la base de datos (usará DATABASE_URL de Render)
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

// Configuración para servir archivos estáticos (CORREGIDO con path.join)
app.use(express.static(path.join(__dirname, 'public')));

// Establecer EJS como motor de plantillas
app.set('view engine', 'ejs');

// =======================================================
// RUTAS
// =======================================================

// Ruta principal para listar productos
app.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id');
        res.render('index', { 
            products: result.rows,
            user: req.session.user
        });
    } catch (err) {
        console.error('Error al obtener productos:', err);
        res.status(500).send('Error interno del servidor');
    }
});

// Ruta de login (simulación)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        // Nota: En una aplicación real, NUNCA almacenes contraseñas en texto plano.
        // Usa bcrypt para hashear y verificar.
        const result = await pool.query('SELECT id, username, email FROM users WHERE email = $1 AND password = $2', [email, password]);

        if (result.rows.length > 0) {
            req.session.user = result.rows[0];
            res.redirect('/');
        } else {
            // Manejar error de autenticación (ej: renderizar la misma página con un mensaje)
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
    // Lógica simple de carrito: almacenar el ID en la sesión
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
        // Prepara los placeholders para la consulta (ej: $1, $2, $3...)
        const placeholders = cartIds.map((_, i) => `$${i + 1}`).join(',');
        
        try {
            // Consulta para obtener detalles de los productos en el carrito
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