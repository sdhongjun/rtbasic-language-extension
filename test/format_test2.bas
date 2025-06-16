' 测试多变量定义格式化 - 只格式化关键字
dim a, b, c As Integer
GLOBAL dim x(10), y(20) As String
DIM p As Integer, q As String, r As Double
LOCAL m,n(5) As Integer, k As String ' 带注释的行
dim i,j 'without type
global dim arr1(10), arr2(20)
DIM str1, str2, str3 As String ' 多个变量共享类型
dim num1 As Integer, str4 As String, flag As Boolean ' 不同类型
GLOBAL DIM count, total As Integer, name As String ' Global with mixed types