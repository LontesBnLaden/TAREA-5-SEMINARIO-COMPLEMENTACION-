
const $ = id => document.getElementById(id);

const formProyecto = $("formProyecto");
const selectorProyecto = $("selectorProyecto");
const campoCodigo = $("codigo");
const campoFecha = $("fecha");
const campoLugar = $("lugar");
const campoResponsable = $("responsable");
const campoEstablecimiento = $("establecimiento");
const campoFoto = $("fotografia");
const campoDescripcion = $("descripcion");
const zonaPrevia = $("zonaPrevia");
const imagenPrevia = $("imagenPrevia");
const listaFotos = $("listaFotos");
const contador = $("contador");
const mensaje = $("mensaje");
const estadoProyecto = $("estadoProyecto");
const proyectoActual = $("proyectoActual");

let db;
let proyectos = [];
let fotos = [];
let proyectoIdActivo = null;
let archivoPendiente = null;
let urlPrevia = null;
let modoEdicion = false;

function avisar(texto, error = false) {
  mensaje.textContent = texto;
  mensaje.style.color = error ? "#b91c1c" : "#166534";
}

function avisarProyecto(texto, error = false) {
  estadoProyecto.textContent = texto;
  estadoProyecto.style.color = error ? "#b91c1c" : "#166534";
}

function fechaActual() {
  const hoy = new Date();
  return [
    hoy.getFullYear(),
    String(hoy.getMonth() + 1).padStart(2, "0"),
    String(hoy.getDate()).padStart(2, "0")
  ].join("-");
}

function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Abrir IndexedDB. La versión 2 agrega proyectos y conserva
// el almacén de fotografías creado en la versión anterior.
function abrirDB() {
  return new Promise((resolve, reject) => {
    const solicitud = indexedDB.open("FiscalizacionDB", 2);

    solicitud.onupgradeneeded = () => {
      const base = solicitud.result;

      if (!base.objectStoreNames.contains("proyectos")) {
        base.createObjectStore("proyectos", { keyPath: "id" });
      }

      if (!base.objectStoreNames.contains("fotografias")) {
        base.createObjectStore("fotografias", { keyPath: "id" });
      }
    };

    solicitud.onsuccess = () => resolve(solicitud.result);
    solicitud.onerror = () => reject(solicitud.error);
    solicitud.onblocked = () => {
      avisar("Cierra otras pestañas de esta aplicación y vuelve a intentarlo.", true);
    };
  });
}

function ejecutar(nombre, modo, operacion) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(nombre, modo);
    const almacen = tx.objectStore(nombre);
    let resultado;

    try {
      resultado = operacion(almacen);
    } catch (error) {
      reject(error);
      return;
    }

    tx.oncomplete = () => resolve(resultado ? resultado.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Operación cancelada"));
  });
}

function datosFormulario() {
  return {
    codigo: campoCodigo.value.trim(),
    fecha: campoFecha.value,
    lugar: campoLugar.value.trim(),
    fiscalizador: campoResponsable.value.trim(),
    establecimiento: campoEstablecimiento.value.trim()
  };
}

function validarProyecto() {
  const datos = datosFormulario();
  const vacio = Object.values(datos).some(valor => !valor);

  if (vacio) {
    avisarProyecto("Completa todos los campos del proyecto.", true);
    return null;
  }

  const codigoDuplicado = proyectos.some(p =>
    p.codigo.toLowerCase() === datos.codigo.toLowerCase() &&
    p.id !== proyectoIdActivo
  );

  if (codigoDuplicado) {
    avisarProyecto("Ya existe un proyecto con ese código.", true);
    return null;
  }

  return datos;
}

function limpiarFormularioProyecto() {
  formProyecto.reset();
  campoFecha.value = fechaActual();
}

function rellenarFormulario(proyecto) {
  campoCodigo.value = proyecto.codigo;
  campoFecha.value = proyecto.fecha;
  campoLugar.value = proyecto.lugar;
  campoResponsable.value = proyecto.fiscalizador;
  campoEstablecimiento.value = proyecto.establecimiento;
}

function actualizarSelector() {
  const anterior = selectorProyecto.value;
  selectorProyecto.innerHTML = "";

  const opcionInicial = document.createElement("option");
  opcionInicial.value = "";
  opcionInicial.textContent = "Selecciona un proyecto guardado";
  selectorProyecto.appendChild(opcionInicial);

  proyectos
    .slice()
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .forEach(proyecto => {
      const opcion = document.createElement("option");
      opcion.value = proyecto.id;
      opcion.textContent = `${proyecto.codigo} — ${proyecto.establecimiento}`;
      selectorProyecto.appendChild(opcion);
    });

  if (proyectos.some(p => p.id === proyectoIdActivo)) {
    selectorProyecto.value = proyectoIdActivo;
  } else if (proyectos.some(p => p.id === anterior)) {
    selectorProyecto.value = anterior;
  }
}

async function cargarProyectos() {
  proyectos = await ejecutar("proyectos", "readonly", almacen => almacen.getAll());
  actualizarSelector();
}

async function cargarFotosProyecto() {
  if (!proyectoIdActivo) {
    fotos.forEach(foto => URL.revokeObjectURL(foto.url));
    fotos = [];
    mostrarFotos();
    proyectoActual.textContent = "Crea o abre un proyecto para registrar fotografías.";
    return;
  }

  const registros = await ejecutar(
    "fotografias",
    "readonly",
    almacen => almacen.getAll()
  );

  fotos.forEach(foto => URL.revokeObjectURL(foto.url));

  fotos = (registros || [])
    .filter(foto => foto.proyectoId === proyectoIdActivo)
    .sort((a, b) => a.orden - b.orden)
    .map(foto => ({
      ...foto,
      url: URL.createObjectURL(foto.blob)
    }));

  const proyecto = proyectos.find(p => p.id === proyectoIdActivo);
  proyectoActual.textContent = proyecto
    ? `Proyecto activo: ${proyecto.codigo} — ${proyecto.establecimiento}`
    : "No hay proyecto seleccionado.";

  mostrarFotos();
}

async function abrirProyecto(id) {
  const proyecto = proyectos.find(p => p.id === id);

  if (!proyecto) {
    proyectoIdActivo = null;
    modoEdicion = false;
    limpiarFormularioProyecto();
    await cargarFotosProyecto();
    return;
  }

  proyectoIdActivo = proyecto.id;
  modoEdicion = true;
  rellenarFormulario(proyecto);
  selectorProyecto.value = proyecto.id;

  await cargarFotosProyecto();
  avisarProyecto(`Proyecto ${proyecto.codigo} abierto correctamente.`);
  avisar("");
}

selectorProyecto.addEventListener("change", async () => {
  try {
    await abrirProyecto(selectorProyecto.value);
  } catch (error) {
    console.error(error);
    avisarProyecto("No se pudo abrir el proyecto.", true);
  }
});

$("btnNuevo").addEventListener("click", () => {
  proyectoIdActivo = null;
  modoEdicion = false;
  selectorProyecto.value = "";
  limpiarFormularioProyecto();
  cancelarPrevia();
  cargarFotosProyecto();
  avisarProyecto("Completa los datos y pulsa Guardar proyecto.");
  avisar("");
});

$("btnEditar").addEventListener("click", () => {
  if (!proyectoIdActivo) {
    avisarProyecto("Primero abre el proyecto que deseas editar.", true);
    return;
  }

  modoEdicion = true;
  avisarProyecto("Edita los datos y pulsa Guardar proyecto para aplicar los cambios.");
});

formProyecto.addEventListener("submit", event => event.preventDefault());

$("btnGuardarProyecto").addEventListener("click", async () => {
  const datos = validarProyecto();
  if (!datos) return;

  try {
    const id = proyectoIdActivo || nuevoId();
    const anterior = proyectos.find(p => p.id === id);

    const proyecto = {
      id,
      ...datos,
      creadoEn: anterior?.creadoEn || new Date().toISOString(),
      actualizadoEn: new Date().toISOString()
    };

    await ejecutar("proyectos", "readwrite", almacen => almacen.put(proyecto));

    proyectoIdActivo = id;
    modoEdicion = true;

    await cargarProyectos();
    selectorProyecto.value = id;
    await cargarFotosProyecto();

    avisarProyecto(`Proyecto ${proyecto.codigo} guardado correctamente.`);
    avisar("Los datos del proyecto están guardados.");
  } catch (error) {
    console.error(error);
    avisarProyecto("No se pudo guardar el proyecto.", true);
  }
});

// Seleccionar imagen y mostrar la vista previa.
campoFoto.addEventListener("change", () => {
  const archivo = campoFoto.files[0];

  if (!archivo) {
    cancelarPrevia();
    avisar("No se seleccionó ninguna fotografía. Puedes intentarlo de nuevo.");
    return;
  }

  if (!archivo.type.startsWith("image/")) {
    campoFoto.value = "";
    cancelarPrevia();
    avisar("Selecciona un archivo de imagen válido.", true);
    return;
  }

  if (urlPrevia) URL.revokeObjectURL(urlPrevia);

  archivoPendiente = archivo;
  urlPrevia = URL.createObjectURL(archivo);
  imagenPrevia.src = urlPrevia;
  zonaPrevia.hidden = false;
  campoDescripcion.value = "";
  avisar("Revisa la imagen y su descripción antes de confirmarla.");
});

function cancelarPrevia() {
  if (urlPrevia) URL.revokeObjectURL(urlPrevia);

  urlPrevia = null;
  archivoPendiente = null;
  imagenPrevia.removeAttribute("src");
  zonaPrevia.hidden = true;
  campoFoto.value = "";
  campoDescripcion.value = "";
}

$("btnCancelar").addEventListener("click", () => {
  cancelarPrevia();
  avisar("Se canceló la incorporación. No se guardó ninguna fotografía.");
});

$("btnConfirmar").addEventListener("click", async () => {
  if (!proyectoIdActivo) {
    avisar("Primero guarda o abre un proyecto.", true);
    return;
  }

  const proyecto = proyectos.find(p => p.id === proyectoIdActivo);
  if (!proyecto) {
    avisar("El proyecto activo ya no está disponible. Ábrelo de nuevo.", true);
    return;
  }

  if (!archivoPendiente) {
    avisar("Selecciona una imagen antes de confirmar.", true);
    return;
  }

  const descripcion = campoDescripcion.value.trim();

  if (!descripcion) {
    avisar("Escribe la descripción de la fotografía.", true);
    campoDescripcion.focus();
    return;
  }

  const boton = $("btnConfirmar");
  boton.disabled = true;

  try {
    const foto = {
      id: nuevoId(),
      proyectoId: proyectoIdActivo,
      blob: archivoPendiente,
      descripcion,
      incorporadaEn: new Date().toISOString(),
      orden: fotos.length
    };

    await ejecutar("fotografias", "readwrite", almacen => almacen.put(foto));

    cancelarPrevia();
    await cargarFotosProyecto();
    avisar("Fotografía incorporada y guardada correctamente.");
  } catch (error) {
    console.error(error);
    avisar("No se pudo guardar la fotografía. Inténtalo de nuevo.", true);
  } finally {
    boton.disabled = false;
  }
});

function mostrarFotos() {
  listaFotos.innerHTML = "";
  contador.textContent =
    `${fotos.length} fotografía${fotos.length === 1 ? "" : "s"}`;

  if (!fotos.length) {
    listaFotos.innerHTML =
      '<p class="vacio">Este proyecto todavía no tiene fotografías.</p>';
    return;
  }

  fotos.forEach((foto, indice) => {
    const tarjeta = document.createElement("article");
    tarjeta.className = "tarjeta-foto";

    const imagen = document.createElement("img");
    imagen.src = foto.url;
    imagen.alt = `Fotografía ${indice + 1}`;

    const titulo = document.createElement("h3");
    titulo.textContent = `Fotografía N.º ${indice + 1}`;

    const identificador = document.createElement("p");
    identificador.textContent = `ID: ${foto.id}`;

    const fecha = document.createElement("p");
    fecha.textContent = `Incorporada: ${new Date(foto.incorporadaEn).toLocaleString()}`;

    const descripcion = document.createElement("textarea");
    descripcion.rows = 3;
    descripcion.value = foto.descripcion;
    descripcion.setAttribute("aria-label", `Descripción foto ${indice + 1}`);

    const acciones = document.createElement("div");
    acciones.className = "acciones";

    const guardar = document.createElement("button");
    guardar.textContent = "Guardar descripción";
    guardar.addEventListener("click", async () => {
      const texto = descripcion.value.trim();

      if (!texto) {
        avisar("La descripción no puede quedar vacía.", true);
        return;
      }

      try {
        foto.descripcion = texto;
        await guardarFotoEnDB(foto);
        avisar("Descripción actualizada.");
      } catch (error) {
        console.error(error);
        avisar("No se pudo guardar la descripción.", true);
      }
    });

    const subir = document.createElement("button");
    subir.textContent = "↑ Subir";
    subir.disabled = indice === 0;
    subir.addEventListener("click", () => moverFoto(indice, indice - 1));

    const bajar = document.createElement("button");
    bajar.textContent = "↓ Bajar";
    bajar.disabled = indice === fotos.length - 1;
    bajar.addEventListener("click", () => moverFoto(indice, indice + 1));

    const eliminar = document.createElement("button");
    eliminar.textContent = "Eliminar";
    eliminar.className = "btn-eliminar";
    eliminar.addEventListener("click", async () => {
      if (!confirm(`¿Eliminar la fotografía N.º ${indice + 1}?`)) return;

      try {
        await ejecutar("fotografias", "readwrite", almacen => almacen.delete(foto.id));
        URL.revokeObjectURL(foto.url);
        await guardarOrdenFotos();
        await cargarFotosProyecto();
        avisar("Fotografía eliminada.");
      } catch (error) {
        console.error(error);
        avisar("No se pudo eliminar la fotografía.", true);
      }
    });

    acciones.append(guardar, subir, bajar, eliminar);
    tarjeta.append(imagen, titulo, identificador, fecha, descripcion, acciones);
    listaFotos.appendChild(tarjeta);
  });
}

async function guardarFotoEnDB(foto) {
  await ejecutar("fotografias", "readwrite", almacen => almacen.put({
    id: foto.id,
    proyectoId: foto.proyectoId,
    blob: foto.blob,
    descripcion: foto.descripcion,
    incorporadaEn: foto.incorporadaEn,
    orden: foto.orden
  }));
}

async function guardarOrdenFotos() {
  const todas = await ejecutar("fotografias", "readonly", almacen => almacen.getAll());
  const otras = (todas || []).filter(foto => foto.proyectoId !== proyectoIdActivo);

  await new Promise((resolve, reject) => {
    const tx = db.transaction("fotografias", "readwrite");
    const almacen = tx.objectStore("fotografias");

    fotos.forEach((foto, indice) => {
      almacen.put({
        id: foto.id,
        proyectoId: foto.proyectoId,
        blob: foto.blob,
        descripcion: foto.descripcion,
        incorporadaEn: foto.incorporadaEn,
        orden: indice
      });
    });

    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function moverFoto(origen, destino) {
  if (destino < 0 || destino >= fotos.length) return;

  const [foto] = fotos.splice(origen, 1);
  fotos.splice(destino, 0, foto);

  fotos.forEach((item, indice) => item.orden = indice);

  try {
    await guardarOrdenFotos();
    mostrarFotos();
    avisar("Orden actualizado y guardado.");
  } catch (error) {
    console.error(error);
    avisar("No se pudo guardar el nuevo orden.", true);
  }
}

// Convertir imágenes para insertarlas dentro del archivo DOCX.
async function prepararImagen(url) {
  const imagen = new Image();

  await new Promise((resolve, reject) => {
    imagen.onload = resolve;
    imagen.onerror = () => reject(new Error("No se pudo leer una fotografía."));
    imagen.src = url;
  });

  const escala = Math.min(
    720 / imagen.naturalWidth,
    460 / imagen.naturalHeight,
    1
  );

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(imagen.naturalWidth * escala));
  canvas.height = Math.max(1, Math.round(imagen.naturalHeight * escala));

  canvas.getContext("2d").drawImage(
    imagen, 0, 0, canvas.width, canvas.height
  );

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/jpeg", 0.88)
  );

  if (!blob) throw new Error("No se pudo preparar la imagen.");

  return {
    datos: new Uint8Array(await blob.arrayBuffer()),
    ancho: canvas.width,
    alto: canvas.height
  };
}

$("btnWord").addEventListener("click", async () => {
  if (!proyectoIdActivo) {
    avisar("Abre un proyecto antes de generar el Word.", true);
    return;
  }

  if (!fotos.length) {
    avisar("Agrega al menos una fotografía a este proyecto.", true);
    return;
  }

  if (!window.docx) {
    avisar("No se cargó la biblioteca Word. Comprueba Internet.", true);
    return;
  }

  const boton = $("btnWord");
  boton.disabled = true;
  boton.textContent = "Generando Word...";

  try {
    const {
      Document, Packer, Paragraph, TextRun, ImageRun,
      Table, TableRow, TableCell, WidthType,
      AlignmentType, BorderStyle
    } = window.docx;

    const anchoTabla = 9360;
    const anchoNumero = 1600;
    const anchoDescripcion = anchoTabla - anchoNumero;

    const bordes = {
      top: { style: BorderStyle.SINGLE, size: 4, color: "B7C5D3" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "B7C5D3" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "B7C5D3" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "B7C5D3" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "B7C5D3" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "B7C5D3" }
    };

    const filas = [];

    for (let i = 0; i < fotos.length; i++) {
      const foto = fotos[i];
      const imagen = await prepararImagen(foto.url);
      const escala = Math.min(560 / imagen.ancho, 350 / imagen.alto, 1);

      filas.push(new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            width: { size: anchoTabla, type: WidthType.DXA },
            borders: bordes,
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: imagen.datos,
                    transformation: {
                      width: Math.round(imagen.ancho * escala),
                      height: Math.round(imagen.alto * escala)
                    }
                  })
                ]
              })
            ]
          })
        ]
      }));

      filas.push(new TableRow({
        children: [
          new TableCell({
            width: { size: anchoNumero, type: WidthType.DXA },
            borders: bordes,
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `Foto N.º ${i + 1}`, bold: true })
                ]
              })
            ]
          }),
          new TableCell({
            width: { size: anchoDescripcion, type: WidthType.DXA },
            borders: bordes,
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Descripción: ", bold: true }),
                  new TextRun({ text: foto.descripcion })
                ]
              })
            ]
          })
        ]
      }));
    }

    const proyecto = proyectos.find(p => p.id === proyectoIdActivo);
    const fecha = proyecto.fecha.split("-").reverse().join("/");

    const encabezado = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: "ANEXO FOTOGRÁFICO", bold: true, size: 30 })
        ]
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Código de práctica: ", bold: true }),
          new TextRun({ text: proyecto.codigo })
        ]
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Fecha: ", bold: true }),
          new TextRun({ text: fecha })
        ]
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Lugar: ", bold: true }),
          new TextRun({ text: proyecto.lugar })
        ]
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Fiscalizador: ", bold: true }),
          new TextRun({ text: proyecto.fiscalizador })
        ]
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Establecimiento o unidad: ", bold: true }),
          new TextRun({ text: proyecto.establecimiento })
        ]
      }),
      new Paragraph({ text: "" })
    ];

    const tabla = new Table({
      width: { size: anchoTabla, type: WidthType.DXA },
      columnWidths: [anchoNumero, anchoDescripcion],
      rows: filas,
      borders: bordes
    });

    const documento = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 720, bottom: 720, left: 1440, right: 1440 }
          }
        },
        children: [...encabezado, tabla]
      }]
    });

    const blob = await Packer.toBlob(documento);
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");

    enlace.href = url;
    enlace.download = `anexo_${proyecto.codigo.replace(/[^a-z0-9_-]/gi, "_")}.docx`;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
    avisar("Documento Word generado correctamente con las fotografías de este proyecto.");
  } catch (error) {
    console.error(error);
    avisar("No se pudo generar Word. Revisa la conexión y la consola con F12.", true);
  } finally {
    boton.disabled = false;
    boton.textContent = "Descargar anexo Word (.docx)";
  }
});

// Inicio de la aplicación.
(async function iniciar() {
  campoFecha.value = fechaActual();

  try {
    db = await abrirDB();
    await cargarProyectos();

    if (proyectos.length) {
      await abrirProyecto(proyectos[0].id);
    } else {
      await cargarFotosProyecto();
      avisarProyecto("Crea tu primer proyecto para comenzar.");
    }
  } catch (error) {
    console.error(error);
    avisar("No se pudo abrir el almacenamiento local. Prueba desde Live Server.", true);
  }
})();
