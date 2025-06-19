const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 3000;

// Configuraciones
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));

// Base de datos
const db = new sqlite3.Database('./db.sqlite');

// Crear tablas si no existen
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS empleados (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    datos TEXT,
    foto TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS informes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empleado_id INTEGER,
    tipo TEXT,
    importancia TEXT,
    contenido TEXT,
    FOREIGN KEY (empleado_id) REFERENCES empleados(id)
  )`);
});


// Configuración de Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Rutas
app.get('/', (req, res) => {
  db.all('SELECT * FROM empleados', (err, empleados) => {
    res.render('index', { empleados });
  });
});

app.get('/empleado/nuevo', (req, res) => {
  res.render('nuevoEmpleado');
});

app.post('/empleado/nuevo', upload.single('foto'), (req, res) => {
  const { nombre, datos } = req.body;
  const fotoRuta = req.file ? `/uploads/${req.file.filename}` : '/default-avatar.png';

  db.run(
    'INSERT INTO empleados(nombre, datos, foto) VALUES (?, ?, ?)',
    [nombre, datos, fotoRuta],
    function(err) {
      if (err) {
        console.error('Error insertando empleado:', err.message);
        return res.status(500).send('Error al guardar empleado.');
      }
      res.redirect('/');
    }
  );
});

app.get('/empleado/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM empleados WHERE id = ?', [id], (err, empleado) => {
    db.all('SELECT * FROM informes WHERE empleado_id = ?', [id], (err, informes) => {
      res.render('empleado', { empleado, informes });
    });
  });
});

app.post('/informe/nuevo', (req, res) => {
  const { empleado_id, tipo, importancia, contenido } = req.body;
  db.run(
    'INSERT INTO informes (empleado_id, tipo, importancia, contenido) VALUES (?, ?, ?, ?)',
    [empleado_id, tipo, importancia, contenido],
    () => res.redirect(`/empleado/${empleado_id}`)
  );
});

app.post('/informe/eliminar', (req, res) => {
  const { id, empleado_id } = req.body;
  db.run('DELETE FROM informes WHERE id = ?', [id], () => {
    res.redirect(`/empleado/${empleado_id}`);
  });
});

// Mostrar formulario de edición
app.get('/empleado/editar/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM empleados WHERE id = ?', [id], (err, empleado) => {
    if (err || !empleado) return res.status(404).send('Empleado no encontrado');
    res.render('editarEmpleado', { empleado });
  });
});

// Guardar cambios de edición
app.post('/empleado/editar/:id', upload.single('foto'), (req, res) => {
  const { nombre, datos } = req.body;
  const id = req.params.id;

  db.get('SELECT foto FROM empleados WHERE id = ?', [id], (err, row) => {
    const nuevaFoto = req.file ? `/uploads/${req.file.filename}` : row.foto;

    db.run(
      'UPDATE empleados SET nombre = ?, datos = ?, foto = ? WHERE id = ?',
      [nombre, datos, nuevaFoto, id],
      (err) => {
        if (err) return res.status(500).send('Error al actualizar empleado.');
        res.redirect(`/empleado/${id}`);
      }
    );
  });
});

// Eliminar empleado con confirmación
app.post('/empleado/eliminar/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM empleados WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).send('Error al eliminar empleado.');
    res.redirect('/');
  });
});

const axios = require('axios');

// Evaluar con IA usando OpenRouter
app.post('/empleado/evaluar/:id', (req, res) => {
  const id = req.params.id;

  db.all('SELECT * FROM informes WHERE empleado_id = ?', [id], async (err, informes) => {
    if (err || !informes.length) return res.status(400).send('No hay informes para evaluar.');

    const contenido = informes.map((inf, i) =>
      `#${i+1} - Tipo: ${inf.tipo}, Importancia: ${inf.importancia}, Contenido: ${inf.contenido}`
    ).join('\n');

    const prompt = `
Actúa como un analista de RRHH. Evalúa los siguientes informes para determinar el rendimiento general del empleado del 0 al 100 (donde 0 es pésimo y 100 es excelente). Devuelve solo un número entero, sin explicaciones ni símbolos:

${contenido}
`;

    try {
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: 'deepseek/deepseek-r1-0528:free', // o mistralai/mixtral
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000' // tu dominio si lo alojas
        }
      });

      const result = response.data.choices[0].message.content.trim();
      const puntuacion = parseInt(result);

      if (!isNaN(puntuacion) && puntuacion >= 0 && puntuacion <= 100) {
        db.run('UPDATE empleados SET rendimiento = ? WHERE id = ?', [puntuacion, id], () => {
          res.redirect(`/empleado/${id}`);
        });
      } else {
        res.status(400).send('Respuesta inválida de la IA: ' + result);
      }
    } catch (error) {
      console.error('Error con OpenRouter:', error.response?.data || error.message);
      res.status(500).send('Error al evaluar rendimiento.');
    }
  });
});

// Inicio
app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});