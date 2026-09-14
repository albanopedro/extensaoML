# ============================================================================
# EMPACOTAR - gera o .zip da extensao para enviar a cliente
#
# Por que um script? Zipar a pasta de trabalho inteira levava junto o que
# nunca pode sair daqui: teste/MLreal* e teste/testenomantereal* (paginas
# reais, com dados de produto, de vendedor e JSONs de sessao do Mercado
# Livre), o contexto.md e a pasta .git. O .gitignore protege o repositorio,
# nao o zip.
#
# Por isso a lista abaixo e de INCLUSAO, nao de exclusao: so entra o que a
# extensao precisa para rodar. Um arquivo novo criado fora dessas pastas
# fica de fora sozinho, sem ninguem precisar lembrar.
#
# Como rodar, na pasta do projeto:
#
#   powershell -ExecutionPolicy Bypass -File .\empacotar.ps1
#
# Resultado: dist\ML-Metrics-<versao>.zip, com a versao lida do manifest.json
# - o nome do arquivo ja diz qual versao a cliente recebeu.
# ============================================================================

$ErrorActionPreference = "Stop"

# ZipFile/ZipArchive do .NET. Nao usamos Compress-Archive: no PowerShell 5.1
# (o que vem no Windows) ele grava os caminhos com "\" dentro do zip, fora do
# padrao do formato - o Windows extrai, mas outras ferramentas podem criar
# arquivos chamados "src\coletor.js" em vez da pasta src.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$raiz = $PSScriptRoot

$manifest = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $raiz "manifest.json") | ConvertFrom-Json
$versao = $manifest.version

# Tudo que a extensao precisa, e nada mais.
$incluir = @("manifest.json", "icons", "src")

$pastaDist = Join-Path $raiz "dist"
New-Item -ItemType Directory -Force -Path $pastaDist | Out-Null
$destino = Join-Path $pastaDist ("ML-Metrics-" + $versao + ".zip")

# ZipArchiveMode Create nao sobrescreve: um zip anterior da MESMA versao sai
# antes. E arquivo gerado por este script, refeito agora mesmo.
if (Test-Path $destino) {
    Remove-Item -Path $destino -Force
}

$zip = [System.IO.Compression.ZipFile]::Open($destino, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    foreach ($nome in $incluir) {
        $item = Get-Item -Path (Join-Path $raiz $nome)

        # Pasta entra com todos os arquivos dentro; arquivo entra sozinho.
        if ($item.PSIsContainer) {
            $arquivos = Get-ChildItem -Path $item.FullName -Recurse -File
        } else {
            $arquivos = @($item)
        }

        foreach ($arquivo in $arquivos) {
            # Caminho relativo a raiz, sempre com "/" - o separador do formato.
            $relativo = $arquivo.FullName.Substring($raiz.Length + 1).Replace("\", "/")
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $arquivo.FullName, $relativo) | Out-Null
        }
    }
}
finally {
    # Sem o Dispose o zip fica incompleto e travado em disco.
    $zip.Dispose()
}

Write-Host ("Pacote gerado: " + $destino)
