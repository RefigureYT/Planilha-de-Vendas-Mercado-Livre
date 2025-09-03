const XLSX = require("xlsx");
const fs = require("fs");
const mysql = require("mysql2/promise");
const axios = require("axios");
const path = require("path");

const path_xlsx = "./XLSX_ML";
const path_xlsx_pronto = "./XLSX_PRONTO";
const path_xlsx_feitos = "./XLSX_FEITOS";

let raw = ""; // Conteúdo bruto do arquivo creds.json
let creds = {}; // Objeto para armazenar as credenciais lidas do arquivo creds.json
let authToken = ""; // Token de autenticação do Mercado Livre
let id_api_valor = ""; // ID da Empresa do Mercado Livre (Define API a ser usada)
let listaMlbComVendas = []; // Declara a lista para adicionar os MLBs com vendas posteriormente

let worksheetName = "Anúncios"; // Nome da planilha dentro do arquivo XLSX


// Utils
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)); // Função para pausar a execução por um tempo (em milissegundos)
const chunk = (array, size) => {
    return Array.from({ length: Math.ceil(array.length / size) }, (v, i) =>
        array.slice(i * size, i * size + size)
    );
}; // Função para dividir um array em pedaços menores


async function run() {
    try {
        const arquivos = fs.readdirSync(path_xlsx);
        if (arquivos.length === 0) {
            console.log("Nenhum arquivo encontrado na pasta XLSX_ML.");
            process.exit(0);
        } else if (arquivos.length > 1) {
            console.log("Tem mais de um arquivo na pasta XLSX_ML. Por favor, deixe apenas um arquivo.");
            process.exit(1);
        } else {
            const arquivo = arquivos[0];
            if (!arquivo.endsWith(".xlsx")) {
                console.log("O arquivo na pasta XLSX_ML não é um arquivo .xlsx. Por favor, coloque um arquivo válido.");
                process.exit(1);
            } else {
                try {
                    raw = fs.readFileSync("./creds.json");
                    creds = JSON.parse(raw);

                    tokens = await buscarTokenMercadoLivre();

                    if (!tokens) {
                        console.error("Token de autenticação do Mercado Livre não encontrado. Verifique o arquivo creds.json.");
                        process.exit(1);
                    }

                    start(arquivo, tokens);
                } catch (err) {
                    console.error("Erro ao ler ou parsear o arquivo creds.json:", err);
                    process.exit(1);
                }
            }
        }
    } catch (err) {
        console.error("Erro ao ler a pasta XLSX_ML:", err);
        process.exit(1);
    }
}

async function start(xlsx_file, tokens) {
    const workbook = XLSX.readFile(`${path_xlsx}/${xlsx_file}`); // Lê o arquivo XLSX

    const worksheet = workbook.Sheets[worksheetName]; // Seleciona a planilha "Anúncios"
    if (!worksheet) {
        console.log(`A planilha "${worksheetName}" não foi encontrada no arquivo XLSX.`);
        process.exit(1);
    }

    const dados = XLSX.utils.sheet_to_json(worksheet, {
        header: 1, // Retorna um array de arrays, sem usar a primeira linha como cabeçalho
        defval: null // Define valores padrão para células vazias
    }); // Converte a planilha para JSON

    console.log("Planilha >", dados);
    const colunaA = dados
        .map(linha => [linha[0], linha[3], linha[4], linha[8]]) // Seleciona apenas a coluna A (índice 0), D (índice 3), E (índice 4) e I (índice 8)
        .filter(linha => linha[0] !== null && linha[0] !== undefined && linha[0] !== "") // Remove linhas onde a coluna A é nula ou indefinida
        .filter(coluna => coluna[0].includes("MLB") &&
            coluna[1].trim() === "Sem Giro" &&
            coluna[2].trim() === "Sem Giro" &&
            coluna[3] === 0)
        .map(linha => linha[0]); // Filtra apenas os valores que começam com "MLB" e que atendem aos critérios das colunas D, E e I

    console.log("Os 10 primeiros valores válidos na coluna A são:", colunaA.slice(0, 10).map(linha => linha[0]));

    console.log("Verificando se há duplicatas na coluna A...");

    const unicos = [...new Set(colunaA)]; // Cria um array com valores únicos (ordem original mantida)

    const qtdDuplicatas = colunaA.length - unicos.length; // Calcula a quantidade de duplicatas

    if (qtdDuplicatas > 0) {
        console.log(`Foram encontradas ${qtdDuplicatas} duplicatas na coluna A.`);
    } else {
        console.log("Nenhuma duplicata encontrada na coluna A.");
    }

    console.log("Definindo Token de autenticação para o Mercado Livre...");

    // Verifica de qual empresa é o anúncio e define o token de autenticação correspondente
    for (const token of tokens) {
        const empresaValida = await validaEmpresa(token, unicos[0]); // Verifica a empresa do primeiro anúncio como exemplo

        if (empresaValida) {
            authToken = token.access_token;
            id_api_valor = token.id_api_valor;
            break;
        }
    }

    if (!authToken) {
        console.error("Nenhum token de autenticação válido encontrado para os anúncios fornecidos.");
        process.exit(1);
    }

    console.log(`Token definido para a empresa com ID ${id_api_valor}. Iniciando busca de vendas...`);

    console.log(`Foram encontrados ${unicos.length} valores na coluna A.`);
    console.log("Valores encontrados:", unicos);

    listaMlbComVendas = await processarEmLotes(unicos, 50);

    console.log("Lista de MLBs com vendas:", listaMlbComVendas.slice(0, 10));

    // Cria nova planilha dentro de XLSX_PRONTO com os valores de listaMLbComVendas
    const novaPlanilha = XLSX.utils.json_to_sheet(listaMlbComVendas);
    const novoWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(novoWorkbook, novaPlanilha, "Vendas");

    // Salva o novo arquivo XLSX na pasta XLSX_PRONTO
    const novoArquivo = `${path_xlsx_pronto}/Vendas_${Date.now()}.xlsx`;
    XLSX.writeFile(novoWorkbook, novoArquivo);

    console.log(`Novo arquivo criado em ${novoArquivo}`);

    console.log(`Movendo ${xlsx_file} para XLSX_FEITOS`);

    const origemPath = path.join(path_xlsx, xlsx_file);
    const destinoPath = path.join(path_xlsx_feitos, xlsx_file);
    try {
        fs.renameSync(origemPath, destinoPath);
        console.log(`Arquivo movido de ${origemPath} para ${destinoPath}`);
    } catch (err) {
        if (err.code === "EXDEV") { // Partições diferentes: copia + apaga
            fs.copyFileSync(origemPath, destinoPath);
            fs.unlinkSync(origemPath);
            console.log(`Arquivo copiado e removido da origem (EXDEV): ${destinoPath}`);
        } else {
            console.error(`Erro ao mover arquivo: ${err.message}`);      
            process.exit(1);      
        }        
    }

    process.exit(0);
}

async function validaEmpresa(token, mlb) {
    let empresa = "";
    if (token.id_api_valor == 1) {
        empresa = "Silvio";
    } else if (token.id_api_valor == 2) {
        empresa = "Lucas";
    } else if (token.id_api_valor == 3) {
        empresa = "Leandro";
    } else {
        console.log(`ID da empresa ${token.id_api_valor} não reconhecido.`);
        return false;
    }

    console.log(`Verificando empresa ${empresa} para o anúncio ${mlb}...`);

    try {
        await axios.get(`https://api.mercadolibre.com/items/${mlb}`, {
            headers: { Authorization: `Bearer ${token.access_token}` }
        });
        console.log(`Anúncio ${mlb} pertence à empresa ${empresa}. Token definido.`);

        return true;
    } catch (err) {
        if (err.response.status === 401 || err.response.status === 403) {
            console.log(`Token inválido para a empresa ${empresa}. Tentando próximo token...`);
            return false;
        } else if (err.response.status === 404) {
            console.log(`Anúncio ${mlb} não encontrado. Verifique se o código está correto.`);
            return false;
        } else {
            console.error(`Erro ao verificar o anúncio ${mlb} para a empresa ${empresa}:`, err.message);
            return false;
        }
    }
}

// Função para buscar o token do Mercado Livre no banco de dados
async function buscarTokenMercadoLivre() {
    try {
        const connection = await mysql.createConnection({
            host: creds.db_api.host,
            user: creds.db_api.user,
            password: creds.db_api.password,
            database: creds.db_api.database,
            port: creds.db_api.port
        });

        const sql = `
        SELECT *
        FROM apis_valores
        WHERE id_api_valor IN (?, ?, ?)
        `;

        // ID das linhas que contém os tokens do Mercado Livre
        const param = [1, 2, 3]; // IDs das empresas Silvio, Lucas e Leandro, respectivamente || Pode ser alterado conforme necessidade

        const [rows] = await connection.execute(sql, param);

        console.log("Tokens encontrados no banco de dados:", rows);

        if (rows.length > 0) {
            return rows; // Retorna o array de tokens encontrados
        } else {
            return null;
        }
    } catch (err) {
        console.error("Erro ao conectar ao banco de dados ou buscar o token:", err);
        return null;
    }
}

async function buscarVendas(mlb) {
    const url = `https://api.mercadolibre.com/items/${mlb}`;
    const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${authToken}` }
    });
    return response.data.sold_quantity;
}

async function buscarVendasComRetry(mlb, retries = 0) {
    const delays = [10000, 20000, 40000, 60000, 120000, 240000, 360000, 600000]; // 10s, 20s, 40s, 1m, 2m, 4m, 6m, 10m

    try {
        return await buscarVendas(mlb);
    } catch (err) {
        if (err.response) {
            if (err.response.status === 404) {
                console.log(`Anúncio ${mlb} não encontrado. Verifique se o código está correto.`);
                return 0;
            } else if (err.response.status === 401 || err.response.status === 403) {
                console.error(`Token de autenticação inválido ou expirado ao buscar vendas para o anúncio ${mlb}.`);
                return 0;
            } else if (err.response.status === 429) {
                if (retries < delays.length) {
                    const delay = delays[retries];
                    console.warn(`Limite de requisições atingido para o anúncio ${mlb}. Tentando novamente em ${delay / 1000} segundos (tentativa ${retries + 1}/${delays.length})...`);
                    await sleep(delay);
                    return buscarVendasComRetry(mlb, retries + 1);
                } else {
                    console.error(`Limite máximo de tentativas atingido para o anúncio ${mlb}. Desistindo.`);
                    return 0;
                }
            } else {
                console.error(`Erro ao buscar vendas para o anúncio ${mlb}:`, err.message);
                return 0;
            }
        } else {
            console.error(`Erro de rede ou desconhecido ao buscar vendas para o anúncio ${mlb}:`, err.message);
            return 0;
        }
    }
}

async function processarEmLotes(unicos, tamLote = 10) {
    const lotes = chunk(unicos, tamLote);
    const resultados = [];

    for (let i = 0; i < lotes.length; i++) {
        const lote = lotes[i];
        console.log(`Processando lote ${i + 1}/${lotes.length} (itens: ${lote.length})...`);

        // Dispara todas as requisições em paralelo e espera todas as respostas
        const respostas = await Promise.all(lote.map(async mlb => {
            const vendas = await buscarVendasComRetry(mlb);
            return { MLB: mlb, Vendas: vendas };
        }));
        resultados.push(...respostas);
    }

    return resultados;
}

run();