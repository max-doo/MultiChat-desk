/**
 * 工作区文件类型图标统一入口。
 * 资源来自 vscode-material-icon-theme (material-extensions, MIT)，按扩展名映射。
 */
import type { WorkbenchFileNode } from '../../../../shared/types/workbench'
import tsIcon from '../../assets/file-icons/typescript.svg'
import jsIcon from '../../assets/file-icons/javascript.svg'
import reactIcon from '../../assets/file-icons/react.svg'
import reactTsIcon from '../../assets/file-icons/react_ts.svg'
import jsonIcon from '../../assets/file-icons/json.svg'
import htmlIcon from '../../assets/file-icons/html.svg'
import cssIcon from '../../assets/file-icons/css.svg'
import sassIcon from '../../assets/file-icons/sass.svg'
import lessIcon from '../../assets/file-icons/less.svg'
import pythonIcon from '../../assets/file-icons/python.svg'
import vueIcon from '../../assets/file-icons/vue.svg'
import svelteIcon from '../../assets/file-icons/svelte.svg'
import javaIcon from '../../assets/file-icons/java.svg'
import javaclassIcon from '../../assets/file-icons/javaclass.svg'
import cIcon from '../../assets/file-icons/c.svg'
import cppIcon from '../../assets/file-icons/cpp.svg'
import hIcon from '../../assets/file-icons/h.svg'
import hppIcon from '../../assets/file-icons/hpp.svg'
import csharpIcon from '../../assets/file-icons/csharp.svg'
import rustIcon from '../../assets/file-icons/rust.svg'
import goIcon from '../../assets/file-icons/go.svg'
import phpIcon from '../../assets/file-icons/php.svg'
import rubyIcon from '../../assets/file-icons/ruby.svg'
import swiftIcon from '../../assets/file-icons/swift.svg'
import kotlinIcon from '../../assets/file-icons/kotlin.svg'
import sqlIcon from '../../assets/file-icons/database.svg'
import consoleIcon from '../../assets/file-icons/console.svg'
import powershellIcon from '../../assets/file-icons/powershell.svg'
import yamlIcon from '../../assets/file-icons/yaml.svg'
import xmlIcon from '../../assets/file-icons/xml.svg'
import tomlIcon from '../../assets/file-icons/toml.svg'
import iniIcon from '../../assets/file-icons/settings.svg'
import envIcon from '../../assets/file-icons/tune.svg'
import dockerIcon from '../../assets/file-icons/docker.svg'
import gitIcon from '../../assets/file-icons/git.svg'
import graphqlIcon from '../../assets/file-icons/graphql.svg'
import protoIcon from '../../assets/file-icons/proto.svg'
import luaIcon from '../../assets/file-icons/lua.svg'
import rIcon from '../../assets/file-icons/r.svg'
import dartIcon from '../../assets/file-icons/dart.svg'
import pdfIcon from '../../assets/file-icons/pdf.svg'
import wordIcon from '../../assets/file-icons/word.svg'
import tableIcon from '../../assets/file-icons/table.svg'
import powerpointIcon from '../../assets/file-icons/powerpoint.svg'
import logIcon from '../../assets/file-icons/log.svg'
import zipIcon from '../../assets/file-icons/zip.svg'
import documentIcon from '../../assets/file-icons/document.svg'
import bibIcon from '../../assets/file-icons/bibliography.svg'
import bibtexStyleIcon from '../../assets/file-icons/bibtex-style.svg'

const EXT_TO_ICON: Record<string, string> = {
  '.ts': tsIcon,
  '.tsx': reactTsIcon,
  '.js': jsIcon,
  '.jsx': reactIcon,
  '.mjs': jsIcon,
  '.cjs': jsIcon,
  '.json': jsonIcon,
  '.json5': jsonIcon,
  '.jsonl': jsonIcon,
  '.ndjson': jsonIcon,
  '.html': htmlIcon,
  '.htm': htmlIcon,
  '.css': cssIcon,
  '.scss': sassIcon,
  '.sass': sassIcon,
  '.less': lessIcon,
  '.py': pythonIcon,
  '.pyw': pythonIcon,
  '.vue': vueIcon,
  '.svelte': svelteIcon,
  '.java': javaIcon,
  '.class': javaclassIcon,
  '.c': cIcon,
  '.cpp': cppIcon,
  '.cc': cppIcon,
  '.cxx': cppIcon,
  '.h': hIcon,
  '.hpp': hppIcon,
  '.cs': csharpIcon,
  '.rs': rustIcon,
  '.go': goIcon,
  '.php': phpIcon,
  '.rb': rubyIcon,
  '.swift': swiftIcon,
  '.kt': kotlinIcon,
  '.kts': kotlinIcon,
  '.sql': sqlIcon,
  '.sh': consoleIcon,
  '.bash': consoleIcon,
  '.zsh': consoleIcon,
  '.bat': consoleIcon,
  '.cmd': consoleIcon,
  '.ps1': powershellIcon,
  '.yaml': yamlIcon,
  '.yml': yamlIcon,
  '.xml': xmlIcon,
  '.toml': tomlIcon,
  '.ini': iniIcon,
  '.graphql': graphqlIcon,
  '.gql': graphqlIcon,
  '.proto': protoIcon,
  '.lua': luaIcon,
  '.r': rIcon,
  '.dart': dartIcon,
  '.pdf': pdfIcon,
  '.docx': wordIcon,
  '.doc': wordIcon,
  '.dotx': wordIcon,
  '.dot': wordIcon,
  '.rtf': wordIcon,
  '.odt': wordIcon,
  '.xlsx': tableIcon,
  '.xls': tableIcon,
  '.xlsm': tableIcon,
  '.xlsb': tableIcon,
  '.xltx': tableIcon,
  '.xlt': tableIcon,
  '.ods': tableIcon,
  '.csv': tableIcon,
  '.tsv': tableIcon,
  '.pptx': powerpointIcon,
  '.ppt': powerpointIcon,
  '.pptm': powerpointIcon,
  '.potx': powerpointIcon,
  '.pot': powerpointIcon,
  '.ppsx': powerpointIcon,
  '.pps': powerpointIcon,
  '.odp': powerpointIcon,
  '.log': logIcon,
  '.bib': bibIcon,
  '.bst': bibtexStyleIcon,
  '.zip': zipIcon,
  '.tar': zipIcon,
  '.gz': zipIcon,
  '.7z': zipIcon
}

function resolveIcon(node: WorkbenchFileNode): string | null {
  const name = node.name.toLowerCase()
  if (name === 'dockerfile') return dockerIcon
  if (name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules') return gitIcon
  if (name.startsWith('.env')) return envIcon

  const ext = (node.extension || '').toLowerCase()
  if (EXT_TO_ICON[ext]) return EXT_TO_ICON[ext]
  const match = name.match(/\.([^.]+)$/)
  return (match && EXT_TO_ICON[`.${match[1]}`]) || documentIcon
}

interface FileTypeIconProps {
  node: WorkbenchFileNode
  className?: string
}

export default function FileTypeIcon({ node, className = '' }: FileTypeIconProps): JSX.Element | null {
  const src = resolveIcon(node)
  if (!src) return null
  return <img src={src} alt="" draggable={false} className={`shrink-0 ${className}`} />
}
