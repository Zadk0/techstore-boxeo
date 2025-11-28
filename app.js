const express = require('express');
const session = require('express-session');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const path = require('path');
const app = express();

// --- 1. CONFIGURACIÓN DEL PUERTO Y ENTORNO ---
// Usa el puerto proporcionado por el hosting (ej: Render) o 3000 por defecto
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

// 3. CONEXIÓN MySQL (MODIFICACIÓN PARA VARIABLES DE ENTORNO)
// Ahora lee las credenciales del entorno para mayor seguridad en producción.
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', 
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'tu_password_local', // Usa tu clave local como fallback
    database: process.env.DB_DATABASE || 'techstore'
});

db.connect((err) => {
    if (err) {
        console.error('❌ Error al conectar a MySQL:', err.stack);
        // En producción, si la DB falla, la app debe fallar.
        // Pero para el desarrollo local, solo mostraremos el error.
        return; 
    }
    console.log('✅ Conectado a MySQL como id ' + db.threadId);
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
    
    const sql = 'INSERT INTO users (username, email, password) VALUES (?, ?, ?)';
    db.query(sql, [username, email, hashedPassword], (err) => {
        if (err) return res.send('Error al registrar. El email podría estar ya en uso.');
        res.redirect('/login');
    });
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
        if (err || results.length === 0) return res.send('Credenciales incorrectas o usuario no encontrado.');
        
        const user = results[0];
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
    db.query('SELECT * FROM products', (err, products) => {
        if (err) return res.send('Error al cargar productos');
        
        // CORRECCIÓN 1: Asegura que product.price es un número (parseFloat)
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
    // Busca el precio del producto en la DB
    db.query('SELECT price, name, image FROM products WHERE id = ?', [req.body.id], (err, results) => {
        if (err || results.length === 0) return res.send('Producto no encontrado.');

        const product = results[0];
        const { id } = req.body;
        
        // Aseguramos que el precio se guarde como número en la sesión
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
    // Aseguramos que el total se calcule con números
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
    
    // 1. Guardar Orden
    db.query('INSERT INTO orders (user_id, total) VALUES (?, ?)', [userId, total], (err, result) => {
        if (err) return res.send('Error al guardar la orden.');
        const orderId = result.insertId;
        
        // 2. Preparar los detalles
        const itemsData = cart.map(item => [orderId, item.name, item.quantity, item.price]);
        
        // 3. Guardar Items de la orden
        const sqlItems = 'INSERT INTO order_items (order_id, product_name, quantity, price) VALUES ?';
        db.query(sqlItems, [itemsData], (err) => {
            if (err) return res.send('Error al guardar los detalles de la orden.');

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
        });
    });
});

// --- RUTA DE HISTORIAL DE COMPRAS ---

app.get('/history', requireLogin, (req, res) => {
    const userId = req.session.user.id;
    
    db.query('SELECT id, total, date FROM orders WHERE user_id = ? ORDER BY date DESC', [userId], (err, orders) => {
        if (err) return res.send('Error al cargar historial.');
        
        // CORRECCIÓN 2: Asegura que order.total es un número para usar .toFixed(2)
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