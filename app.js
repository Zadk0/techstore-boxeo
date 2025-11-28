const path = require('path');
const express = require('express');
const session = require = require('express-session');
// ¡CAMBIO CLAVE! Usamos 'pg' (PostgreSQL) en lugar de 'mysql2'
const { Pool } = require('pg'); 
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const path = require('path');
const app = express();

// --- 1. CONFIGURACIÓN DEL PUERTO Y ENTORNO ---
const PORT = process.env.PORT || 3000; 

// --- 2. CONFIGURACIÓN DEL SERVIDOR Y MIDDLEWARE ---
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// MIDDLEWARE DE SESIONES
app.use(session({
    secret: 'mi_secreto_super_seguro_e_impenetrable_123',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 horas
}));

// 3. CONEXIÓN PostgreSQL (USANDO DATABASE_URL DE RAILWAY)
// ¡ATENCIÓN! El cliente 'pg' usa la variable DATABASE_URL para la conexión completa
const db = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/techstore',
});

db.connect((err) => {
    if (err) {
        console.error('❌ Error al conectar a PostgreSQL:', err.stack);
        return; 
    }
    console.log('✅ Conectado a PostgreSQL');
});

// Middleware Global: Pasa user y cart a todas las vistas
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.cart = req.session.cart || [];
    next();
});

// Middleware de Protección: Requiere login para rutas protegidas
const requireLogin = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    next();
};

// --- RUTAS DE AUTENTICACIÓN ---

app.get('/register', (req, res) => res.render('register'));

app.post('/register', async (req, res) => {
    const { username, email, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10); 
    
    // CAMBIO: Se usa $1, $2, $3
    const sql = 'INSERT INTO users (username, email, password) VALUES ($1, $2, $3)';
    db.query(sql, [username, email, hashedPassword], (err) => {
        if (err) return res.send('Error al registrar. El email podría estar ya en uso.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
    // CAMBIO: Se usa $1
    db.query('SELECT * FROM users WHERE email = $1', [email], async (err, results) => {
        if (err || results.rows.length === 0) return res.send('Credenciales incorrectas o usuario no encontrado.');
        
        // ¡ATENCIÓN! PostgreSQL devuelve resultados en results.rows
        const user = results.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (isMatch) {
            req.session.user = { id: user.id, username: user.username };
            res.redirect('/');
        } else {
            res.send('Contraseña incorrecta.');
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});


// --- RUTAS DE TIENDA Y CARRITO ---

// HOME: Muestra todos los productos
app.get('/', (req, res) => {
    db.query('SELECT * FROM products', (err, results) => {
        if (err) return res.send('Error al cargar productos');
        
        // ¡ATENCIÓN! PostgreSQL devuelve resultados en results.rows
        const products = results.rows; 
        
        const products_processed = products.map(product => {
            return {
                ...product,
                price: parseFloat(product.price) 
            };
        });
        
        res.render('index', { products: products_processed });
    });
});

// Añadir al carrito
app.post('/add-to-cart', (req, res) => {
    // CAMBIO: Se usa $1
    db.query('SELECT price, name, image FROM products WHERE id = $1', [req.body.id], (err, results) => {
        if (err || results.rows.length === 0) return res.send('Producto no encontrado.');

        const product = results.rows[0];
        const { id } = req.body;
        
        const itemPrice = parseFloat(product.price); 
        
        if (!req.session.cart) req.session.cart = [];
        
        const existingProduct = req.session.cart.find(item => item.id == id);
        
        if (existingProduct) {
            existingProduct.quantity++;
        } else {
            req.session.cart.push({ id: parseInt(id), name: product.name, price: itemPrice, image: product.image, quantity: 1 });
        }
        res.redirect('back'); 
    });
});

// Ver Carrito
app.get('/cart', (req, res) => {
    const cart = req.session.cart || [];
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2);
    res.render('cart', { total });
});

// Actualizar cantidad (Usada por AJAX/Fetch en el frontend)
app.post('/update-cart', (req, res) => {
    const { id, action } = req.body;
    const cart = req.session.cart;
    
    const itemIndex = cart.findIndex(item => item.id == id);
    
    if (itemIndex > -1) {
        if (action === 'increase') cart[itemIndex].quantity++;
        if (action === 'decrease') {
            cart[itemIndex].quantity--;
            if (cart[itemIndex].quantity <= 0) cart.splice(itemIndex, 1);
        }
        if (action === 'remove') cart.splice(itemIndex, 1);
    }
    
    req.session.cart = cart;
    
    const newTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2);
    res.json({ success: true, newTotal: parseFloat(newTotal), cart: req.session.cart });
});

// --- RUTA DE COMPRA Y PDF ---

// Procesa la compra y genera el ticket PDF
app.get('/checkout', requireLogin, (req, res) => {
    const cart = req.session.cart;
    if (!cart || cart.length === 0) return res.redirect('/cart');

    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2);
    const userId = req.session.user.id;
    
    // 1. Guardar Orden (CAMBIO: Se usa $1, $2, y se añade RETURNING id)
    db.query('INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING id', [userId, total], (err, result) => {
        if (err) return res.send('Error al guardar la orden.');
        
        // PostgreSQL devuelve el ID en la primera fila de results.rows
        const orderId = result.rows[0].id;
        
        // 2. Preparar los detalles
        const itemsData = cart.map(item => [orderId, item.name, item.quantity, item.price]);
        
        // 3. Guardar Items de la orden (CAMBIO: Se usa $1, $2, $3, $4)
        // Usamos una función para ejecutar múltiples inserciones
        const insertItemPromises = itemsData.map(item => {
            return db.query('INSERT INTO order_items (order_id, product_name, quantity, price) VALUES ($1, $2, $3, $4)', item);
        });

        Promise.all(insertItemPromises)
            .then(() => {
                // 4. Generar PDF
                const doc = new PDFDocument();
                let filename = `ticket_${req.session.user.username}_${orderId}.pdf`;
                
                res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
                res.setHeader('Content-Type', 'application/pdf');
                
                doc.pipe(res);
                doc.fontSize(25).text('¡Compra Exitosa! - CLETO REYES STORE', { align: 'center' });
                doc.moveDown();
                doc.fontSize(16).text(`Orden No: ${orderId}`);
                doc.text(`Cliente: ${req.session.user.username}`);
                doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`);
                doc.moveDown();
                
                doc.fontSize(14).text('Resumen de Artículos:', { underline: true });
                cart.forEach(item => {
                    doc.text(`- ${item.name}: ${item.quantity} x $${item.price.toFixed(2)} = $${(item.price * item.quantity).toFixed(2)}`);
                });
                
                doc.moveDown();
                doc.fontSize(20).text(`Total Final: $${total}`, { align: 'right' });
                doc.end();

                // 5. Limpiar el carrito
                req.session.cart = [];
            })
            .catch(err => {
                console.error("Error al insertar items:", err);
                res.send('Error al guardar los detalles de la orden.');
            });
    });
});

// --- RUTA DE HISTORIAL DE COMPRAS ---

app.get('/history', requireLogin, (req, res) => {
    const userId = req.session.user.id;
    
    // CAMBIO: Se usa $1
    db.query('SELECT id, total, date FROM orders WHERE user_id = $1 ORDER BY date DESC', [userId], (err, results) => {
        if (err) return res.send('Error al cargar historial.');
        
        // ¡ATENCIÓN! PostgreSQL devuelve resultados en results.rows
        const orders = results.rows;

        const orders_processed = orders.map(order => {
            return {
                ...order,
                total: parseFloat(order.total) 
            };
        });
        
        res.render('history', { orders: orders_processed });
    });
});

// 4. INICIO DEL SERVIDOR
app.listen(PORT, () => console.log(`🚀 Servidor Express corriendo en http://localhost:${PORT}`));
