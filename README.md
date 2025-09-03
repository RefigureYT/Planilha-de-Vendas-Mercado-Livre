# Planilha de Vendas Mercado Livre

Este projeto é um script Node.js desenvolvido para automatizar a extração de dados de vendas do Mercado Livre e gerar uma planilha Excel (`.xlsx`) com essas informações. Ele foi projetado para funcionar com uma base de dados MySQL para gerenciamento de tokens de autenticação.

## Pré-requisitos

Antes de começar, certifique-se de ter o seguinte instalado:

-   **Node.js**: Versão 16 ou superior.
-   **npm** (gerenciador de pacotes do Node.js): Geralmente vem junto com o Node.js.
-   **MySQL**: Este script foi desenvolvido com a premissa de uso de um banco de dados MySQL, tipicamente configurado via **XAMPP** para ambiente de desenvolvimento local. Certifique-se de que seu servidor MySQL esteja em execução.

## Instalação

1.  **Clone o repositório** (ou baixe os arquivos do projeto).

2.  **Instale as dependências do Node.js**: Navegue até o diretório raiz do projeto no seu terminal e execute:
    ```bash
    npm install xlsx mysql2 axios
    ```

3.  **Configuração do `creds.json`**: Crie um arquivo chamado `creds.json` na raiz do projeto com a seguinte estrutura. **Substitua os valores de exemplo** pelas suas credenciais reais do banco de dados. **Mantenha este arquivo seguro e nunca o comite em repositórios públicos!**

    ```json
    {
        "db_api": {
            "host": "localhost",
            "port": "3306",
            "user": "seu_usuario_mysql",
            "password": "sua_senha_mysql",
            "database": "seu_banco_de_dados"
        }
    }
    ```

4.  **Configuração do Banco de Dados**: Certifique-se de que seu banco de dados MySQL (`seu_banco_de_dados`) contenha uma tabela `apis_valores` com os tokens de acesso do Mercado Livre para as empresas (IDs 1, 2 e 3, conforme configurado no script). A estrutura da tabela deve incluir `id_api_valor`, `access_token`, entre outros campos relevantes para o seu sistema de tokens.

## Uso

1.  **Prepare o arquivo XLSX de entrada**: Coloque o arquivo Excel (`.xlsx`) contendo os anúncios do Mercado Livre na pasta `./XLSX_ML` na raiz do projeto. O script espera que a planilha de anúncios se chame "Anúncios" e que a coluna A contenha os `ITEM_ID`s (MLBs).

2.  **Execute o script**: No terminal, dentro do diretório raiz do projeto, execute:
    ```bash
    node run.js
    ```

3.  **Verifique a saída**: O script irá processar os anúncios, buscar as vendas no Mercado Livre e gerar um novo arquivo Excel na pasta `./XLSX_PRONTO` com o nome `Vendas_Timestamp.xlsx`. O arquivo de entrada original será movido para a pasta `./XLSX_FEITOS`.

## Estrutura do Código e Manipulação

O script `run.js` é o coração da aplicação. Abaixo, destacamos algumas partes importantes para manipulação:

-   **`path_xlsx`, `path_xlsx_pronto`, `path_xlsx_feitos`**: Variáveis no início do arquivo que definem os diretórios de entrada e saída dos arquivos Excel. Podem ser alteradas conforme sua necessidade.

-   **`worksheetName`**: Define o nome da planilha dentro do arquivo XLSX de entrada que será lida (padrão: "Anúncios").

-   **Filtro de Colunas (`colunaA`)**: A seção onde os dados são lidos do Excel e filtrados é crucial. Atualmente, ela seleciona colunas específicas (A, D, E, I) e aplica filtros rigorosos:
    ```javascript
    const colunaA = dados
        .map(linha => [linha[0], linha[3], linha[4], linha[8]]) // Seleciona colunas A, D, E, I
        .filter(linha => linha[0] !== null && linha[0] !== undefined && linha[0] !== "") // Remove nulos/vazios da coluna A
        .filter(coluna => coluna[0].includes("MLB") &&
            coluna[1].trim() === "Sem Giro" &&
            coluna[2].trim() === "Sem Giro" &&
            coluna[3] === 0) // Filtros específicos para colunas D, E e I
        .map(linha => linha[0]); // Retorna apenas o MLB
    ```
    Se precisar ajustar os critérios de seleção de anúncios (por exemplo, outras colunas ou outros valores), você deve modificar esta seção.

-   **`buscarVendasComRetry(mlb, retries = 0)` (Tratamento de Erro 429)**:
    Esta função é responsável por buscar a quantidade de vendas de um `ITEM_ID` (MLB) específico. Ela inclui uma lógica de *retry com backoff exponencial* para lidar com o erro `HTTP 429 Too Many Requests` da API do Mercado Livre. Se a API retornar 429, o script aguardará um tempo crescente antes de tentar novamente, seguindo a sequência: 10s, 20s, 40s, 1m, 2m, 4m, 6m, 10m. Após a última tentativa, se o erro persistir, a requisição será abandonada para aquele MLB.

    Você pode ajustar os tempos de `delays` dentro desta função, se necessário:
    ```javascript
    const delays = [10000, 20000, 40000, 60000, 120000, 240000, 360000, 600000]; // Em milissegundos
    ```

-   **`processarEmLotes(unicos, tamLote = 10)`**: Esta função processa os MLBs em lotes para otimizar as chamadas à API e evitar sobrecarga. Ela agora retorna um array de objetos no formato `{ MLB: 'MLB123', Vendas: 10 }`, garantindo que a planilha seja gerada corretamente.

## Observações Importantes

-   **Dependência de MySQL/XAMPP**: Atualmente, o script está fortemente acoplado ao uso de um banco de dados MySQL para buscar os tokens de autenticação. Se você precisar usar outro tipo de banco de dados ou um método diferente de gerenciamento de tokens, a função `buscarTokenMercadoLivre()` precisará ser adaptada.

-   **Segurança do `creds.json`**: Nunca exponha seu arquivo `creds.json` em repositórios públicos ou ambientes não seguros. Ele contém credenciais sensíveis do seu banco de dados.

-   **Limites da API do Mercado Livre**: Esteja ciente dos limites de requisição da API do Mercado Livre. Embora o script implemente um mecanismo de retry para o erro 429, o uso excessivo pode levar a bloqueios mais longos ou permanentes. Ajuste o `tamLote` e os `delays` conforme a necessidade e os limites da sua aplicação/conta no Mercado Livre.